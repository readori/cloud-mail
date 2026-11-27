import axios from "axios";
import router from "@/router";
import i18n from "@/i18n/index.js";
import {useSettingStore} from "@/store/setting.js";
import { readCsrfToken, setAuthenticated } from "@/auth/session.js";
import { diag, safePath } from "@/diagnostics/logger.js";

let http = axios.create({
    baseURL: import.meta.env.VITE_BASE_URL,
    withCredentials: true
});

http.interceptors.request.use(config => {
    const { lang } = useSettingStore();
    config.headers['accept-language'] = lang
    config.headers['X-CFMail-Web'] = '1'
    if (['post', 'put', 'patch', 'delete'].includes(String(config.method || '').toLowerCase())) {
        const csrf = readCsrfToken()
        if (csrf) config.headers['X-CSRF-Token'] = csrf
    }
    config.__diagStart = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    return config
})

// 请求耗时（毫秒）；仅记录元数据，不记录请求体与响应体。
function diagDuration(config) {
    const start = config && config.__diagStart
    return start ? Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start) : undefined
}

http.interceptors.response.use((res) => {

        return new Promise((resolve, reject) => {

            const noMsg = res.config.noMsg;
            const data = res.data

            try {
                const code = data && data.code
                diag.log('api', code === 200 ? 'debug' : 'warn', `${(res.config.method || 'get').toUpperCase()} ${safePath(res.config.url)}`, {
                    httpStatus: res.status,
                    code,
                    message: code === 200 ? undefined : (data && data.message),
                    ms: diagDuration(res.config),
                })
            } catch (e) { /* ignore logging errors */ }

            if (noMsg) {

                data.code === 200 ? resolve(data.data) : reject(data)

            } else if (data.code === 401) {
                ElMessage({
                    message: data.message,
                    type: 'error',
                    plain: true,
                    grouping: true,
                    repeatNum: -4,
                })
                setAuthenticated(false)
                router.replace('/login')
                reject(data)
            } else if (data.code === 403) {
                ElMessage({
                    message: data.message,
                    type: 'warning',
                    plain: true,
                    grouping: true,
                    repeatNum: -4,
                })
                reject(data)

            } else if (data.code === 502) {
                ElMessage({
                    message: data.message,
                    type: 'error',
                    plain: true,
                    grouping: true,
                    repeatNum: -4,
                })
                reject(data)
            } else if (data.code !== 200) {
                ElMessage({
                    message: data.message,
                    type: 'error',
                    plain: true,
                    grouping: true,
                    repeatNum: -4,
                })
                reject(data)
            }
            resolve(data.data)
        })
    },
    (error) => {

        try {
            const cfg = error.config || {}
            diag.error('api', `${(cfg.method || 'get').toUpperCase()} ${safePath(cfg.url)}`, {
                httpStatus: error.response && error.response.status,
                code: error.response && error.response.data && error.response.data.code,
                message: (error.response && error.response.data && (error.response.data.message || error.response.data.error)) || error.message,
                errCode: error.code,
                ms: diagDuration(cfg),
            })
        } catch (e) { /* ignore */ }

        // HTTP 403：历史行为是整页重载以重新同步权限/会话。但持续 403（如代登录到无权限的路由）
        // 会导致无限刷新白屏，这里加防循环保护：15 秒内最多重载一次，否则放弃重载仅上报。
        if (error.status === 403) {
            let last = 0
            try { last = Number(sessionStorage.getItem('cfmail_403_reload_at')) || 0 } catch (e) { /* ignore */ }
            const now = Date.now()
            if (now - last > 15000) {
                try { sessionStorage.setItem('cfmail_403_reload_at', String(now)) } catch (e) { /* ignore */ }
                diag.warn('app', 'HTTP 403 触发整页重载（防循环：15s 内仅一次）', { path: safePath((error.config || {}).url) })
                location.reload();
                return;
            }
            diag.warn('app', 'HTTP 403 重复出现，已跳过重载以避免无限刷新', { path: safePath((error.config || {}).url) })
            return Promise.reject(error);
        }

        const noMsg = error.config.noMsg;

        if (noMsg) {
            return Promise.reject(error)
        } else if (error.message.includes('Network Error')) {
            ElMessage({
                message: i18n.global.t('networkErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true,
                repeatNum: -4,
            })
        } else if (error.code === 'ECONNABORTED') {
            ElMessage({
                message: i18n.global.t('timeoutErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true
            })
            ElMessage.error('')
        } else if (error.response) {
            const backendMessage = error.response?.data?.message
                || error.response?.data?.error
                || i18n.global.t('serverBusyErrorMsg')
            ElMessage({
                message: backendMessage,
                type: 'error',
                plain: true,
                grouping: true,
                repeatNum: -4,
            })
        } else {
            ElMessage({
                message: i18n.global.t('reqFailErrorMsg'),
                type: 'error',
                plain: true,
                grouping: true,
                repeatNum: -4,
            })
        }
        return Promise.reject(error)
    })

export default http


