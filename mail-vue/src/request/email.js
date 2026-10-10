import http from '@/axios/index.js';
import {normalizePageSize} from '@/request/params.js'

// full: 1 = 完整字段(正文/附件)，0 = 列表摘要
export function emailList(accountId, allReceive, emailId, timeSort, size, type, full) {
    const params = {
        accountId,
        allReceive,
        timeSort,
        size: normalizePageSize(size, 50, 20),
        type
    }

    if (full !== undefined) params.full = full

    // emailId=0 is an intentional first-page cursor. Descending requests omit
    // it so the Worker starts from the newest message; ascending requests keep
    // the explicit zero cursor.
    if (Number(timeSort) === 1 || Number(emailId) > 0) {
        params.emailId = emailId
    }

    return http.get('/email/list', {params})
}

export function emailDelete(emailIds) {
    return http.delete('/email/delete?emailIds=' + emailIds)
}

export function emailLatest(emailId, accountId, allReceive) {
    return http.get('/email/latest', {params: {emailId, accountId, allReceive}, noMsg: true, timeout: 35 * 1000})
}

export function emailRead(emailIds) {
    return http.put('/email/read', {emailIds})
}

export function emailSend(form,progress) {
    return http.post('/email/send', form,{
        onUploadProgress: (e) => {
            progress(e)
        },
        noMsg: true
    })
}
