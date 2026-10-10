import http from '@/axios/index.js';

export function oauthState(provider) {
    return http.get('/oauth/state', {params: {provider}})
}

export function oauthLinuxDoLogin(code, state, redirectUri) {
    return http.post('/oauth/linuxDo/login', {code, state, redirectUri})
}

export function oauthGithubLogin(code, state, redirectUri) {
    return http.post('/oauth/github/login', {code, state, redirectUri})
}

export function oauthGoogleLogin(code, state, redirectUri) {
    return http.post('/oauth/google/login', {code, state, redirectUri})
}

export function oauthBindUser(form) {
    return http.put('/oauth/bindUser', form)
}
