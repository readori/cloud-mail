import http from '@/axios/index.js'

// 超级管理员代登录到目标账号（可随时切回）。start/stop 由服务端改写会话 Cookie，
// 调用成功后整页刷新即以新身份重新加载。
export function impersonateStart(userId) {
    return http.post('/impersonate/start', { userId })
}

export function impersonateStop() {
    return http.post('/impersonate/stop', {})
}

export function impersonateStatus(noMsg = true) {
    return http.get('/impersonate/status', { noMsg })
}

export function impersonateLogs(params = {}) {
    return http.get('/impersonate/logs', { params })
}
