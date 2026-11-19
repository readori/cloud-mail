<template>
  <emailScroll ref="scroll"
               :cancel-success="cancelStar"
               :star-success="addStar"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               :star-cancel="starCancel"
               :email-read="emailRead"
               :show-unread="true"
               :highlight-text="emailStore.searchParams.text"
               actionLeft="4px"
               @jump="jumpContent"
               @refresh-success="onRefreshSuccess"
  >
  </emailScroll>
</template>

<script setup>
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {useSettingStore} from "@/store/setting.js";
import emailScroll from "@/components/email-scroll/index.vue"
import {emailList, emailDelete, emailLatest, emailRead} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, h, onMounted, onUnmounted, reactive, ref, watch} from "vue";
import {sleep} from "@/utils/time-utils.js";
import router from "@/router/index.js";
import { useRoute } from 'vue-router'
import {inboxWs, isAutoRefreshEnabled} from "@/websocket/client.js";

defineOptions({
  name: 'email'
})

const route = useRoute();
const emailStore = useEmailStore();
const accountStore = useAccountStore();
const settingStore = useSettingStore();
const scroll = ref({})
onMounted(() => {
  emailStore.emailScroll = scroll;
  // 上游 v3.6：收件箱实时推送。连接期间靠推送补拉新邮件，断开时按自动刷新间隔轮询兜底。
  inboxWs.start({
    isEnabled: () => isAutoRefreshEnabled(settingStore.settings.autoRefresh),
    onMessage: onWsMessage,
    onReconnect: () => schedulePullLatest(),
  })
  latest()
})

watch(() => settingStore.settings.autoRefresh, () => {
  inboxWs.sync()
})

function onRefreshSuccess() {
  inboxWs.retryNow()
}

// 推送到达：非「全部收取」时忽略其它账号的信。
function onWsMessage(event) {
  const allReceive = accountStore.currentAccount.allReceive
  if (!allReceive && event?.accountId != null && Number(event.accountId) !== Number(accountStore.currentAccountId)) {
    return
  }
  schedulePullLatest()
}

// 短时间内多条推送合并成一次补拉。
let pullTimer = null
function schedulePullLatest() {
  if (pullTimer) window.clearTimeout(pullTimer)
  pullTimer = window.setTimeout(() => {
    pullTimer = null
    void pullLatest()
  }, 150)
}


watch(() => accountStore.currentAccountId, () => {
  scroll.value.refreshList();
})

watch(
  () => emailStore.searchParams,
  () => {
    scroll.value.refreshList()
  },
  {deep: true}
)

function jumpContent(email) {
  emailStore.contentData.email = emailStore.toContentEmail(email)
  emailStore.contentData.delType = 'logic'
  emailStore.contentData.showUnread = true
  emailStore.contentData.showStar = true
  emailStore.contentData.showReply = true
  router.push({name: 'content', params: {mailbox: 'inbox'}})
}

const existIds = new Set();

// 组件卸载(如退出登录)后停止轮询，避免旧循环访问已销毁的 scroll 引用
let pollingStopped = false
onUnmounted(() => {
  pollingStopped = true
  if (pullTimer) {
    window.clearTimeout(pullTimer)
    pullTimer = null
  }
  inboxWs.stop()
})

// 实时推送未连上时(不支持、被拒绝或断线重连中)按自动刷新间隔轮询。
async function latest() {
  while (!pollingStopped) {

    let autoRefresh = settingStore.settings.autoRefresh;
    await sleep(autoRefresh > 1 ? autoRefresh * 1000 : 3000);

    if (pollingStopped || inboxWs.isConnected() || autoRefresh <= 1) {
      continue;
    }
    await pullLatest()
  }
}

let pulling = false
async function pullLatest() {
    if (pulling) {
      schedulePullLatest()
      return
    }
    if (pollingStopped || !scroll.value || route.name !== 'email') {
      return;
    }

    const searchParams = emailStore.searchParams
    if (searchParams.text || searchParams.startDate || searchParams.endDate) {
      return
    }

    const latestId = scroll.value.latestEmail?.emailId

    if (!scroll.value.firstLoad) {
      pulling = true
      try {
        const accountId = accountStore.currentAccountId
        const allReceive = scroll.value.latestEmail?.allReceive
        let list = []

        //确保发起请求时最后一个邮件是当前账号的,或者
        if (accountId === scroll.value.latestEmail?.reqAccountId) {
          list = await emailLatest(latestId, accountId, allReceive);
        }

        //确保请求回来后，账号没有切换，时间排序没有改变，全部邮件类型没变
        if (accountId === accountStore.currentAccountId && allReceive === accountStore.currentAccount.allReceive) {
          if (list.length > 0) {
            emailStore.applyFullList(list)

            for (let email of list) {

              email.reqAccountId = accountId;
              email.allReceive = allReceive;

              if (!existIds.has(email.emailId)) {

                existIds.add(email.emailId)
                scroll.value?.addItem(email)

                await sleep(50)
              }

            }

          }

        }
      } catch (e) {
        if (e.code === 401 || e.code === 403) {
          settingStore.settings.autoRefresh = 0;
        }
        console.error(e)
      } finally {
        pulling = false
      }
    }
}

function addStar(email) {
  emailStore.starScroll?.addItem(email)
}

function cancelStar(email) {
  emailStore.starScroll?.deleteEmail([email.emailId])
}

function getEmailList(emailId, size) {
  const accountId =  accountStore.currentAccountId;
  const allReceive = accountStore.currentAccount.allReceive;
  return emailStore.fetchList(full =>
    emailList(accountId, allReceive, emailId, 0, size, 0, full, emailStore.searchParams)
  ).then(data => {
    if (data?.latestEmail) {
      data.latestEmail.reqAccountId = accountId;
      data.latestEmail.allReceive = allReceive;
    }
    return data;
  })
}

</script>
<style>
.icon {
  cursor: pointer;
}
</style>
