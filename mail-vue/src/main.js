import {createApp} from 'vue';
import App from './App.vue';
import router from './router';
import './design-tokens.css';
import './style.css';
import { init } from '@/init/init.js';
import { createPinia } from 'pinia';
import piniaPersistedState from 'pinia-plugin-persistedstate';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'nprogress/nprogress.css';
import perm from "@/perm/perm.js";
const pinia = createPinia().use(piniaPersistedState)
import i18n from "@/i18n/index.js";
import { useUiStore } from '@/store/ui.js';
import { diag } from '@/diagnostics/logger.js';
const app = createApp(App).use(pinia)

// 全局错误上报到诊断日志（只记消息与栈，不记业务数据）。
app.config.errorHandler = (err, instance, info) => {
    diag.error('vue', (err && err.message) || String(err), { info, stack: err && err.stack })
    console.error(err)
}
if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
        diag.error('window', (e && e.message) || 'window error', { source: e && e.filename, line: e && e.lineno, col: e && e.colno, stack: e && e.error && e.error.stack })
    })
    window.addEventListener('unhandledrejection', (e) => {
        const reason = e && e.reason
        diag.error('promise', (reason && (reason.message || reason.msg)) || 'unhandled rejection', { stack: reason && reason.stack })
    })
}

// 初始化失败不再整页白屏：记录后仍挂载应用（未登录时路由守卫会跳转登录页）。
try {
    await init()
} catch (e) {
    diag.error('init', (e && e.message) || 'init failed', { stack: e && e.stack })
    console.error('CloudMail init failed', e)
}
const uiStore = useUiStore(pinia)
const applyThemePreset = () => { document.documentElement.dataset.cfTheme = uiStore.themePreset || 'polar' }
applyThemePreset()
uiStore.$subscribe(applyThemePreset)
app.use(router).use(i18n).directive('perm',perm)
app.config.devtools = true;

app.mount('#app');
