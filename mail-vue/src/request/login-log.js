import http from '@/axios/index.js'
import {normalizePagination} from '@/request/params.js'

export function loginLogList(params = {}) {
    return http.get('/loginLog/list', {
        params: normalizePagination(params, {sizeMax: 50, defaultSize: 20})
    })
}
