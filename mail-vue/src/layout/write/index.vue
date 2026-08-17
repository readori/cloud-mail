<template>
  <div class="send" v-show="show">
    <div class="write-box">
      <div class="title">
        <div class="title-left">
          <span class="title-text">
            <Icon icon="hugeicons:quill-write-01" width="28" height="28"/>
          </span>
          <span class="sender">{{ $t('sender') }}:</span>
          <span class="sender-name">{{ form.name }}</span>
          <span class="send-email"><{{ form.sendEmail }}></span>
        </div>
        <div @click="close" style="cursor: pointer;">
          <Icon icon="material-symbols-light:close-rounded" width="22" height="22"/>
        </div>
      </div>
      <div class="container">
        <div class="recipient-fields">
          <el-input-tag
              @add-tag="addTagChange($event, 'receiveEmail')"
              tag-type="primary"
              @input="inputChange($event, 'receiveEmail')"
              size="default"
              v-model="form.receiveEmail"
          >
            <template #prefix>
              <div class="item-title">{{ $t('recipient') }}</div>
              <el-select
                  ref="toSelect"
                  class="write-select"
                  popper-class="write-select"
                  :show-arrow="false"
                  :no-match-text="' '"
                  :no-data-text="' '"
                  @visible-change="selectStatusChange($event, 'receiveEmail')"
                  @change="selectChange($event, 'receiveEmail')"
              >
                <el-option
                    v-for="item in selectRecipientLists.receiveEmail"
                    :key="item"
                    :label="item"
                    :value="item"
                    style="color: #999896;"
                />
              </el-select>
            </template>
            <template #suffix>
              <div class="recipient-actions">
                <button type="button" class="recipient-toggle" :class="{ active: showCc }" @click.stop="showCc = !showCc">{{ $t('cc') }}</button>
                <button type="button" class="recipient-toggle" :class="{ active: showBcc }" @click.stop="showBcc = !showBcc">{{ $t('bcc') }}</button>
                <Icon icon="fa7-solid:user-plus" width="20" height="20" class="add-contact" @click.stop="openContacts('receiveEmail')" />
              </div>
            </template>
          </el-input-tag>

          <el-input-tag
              v-if="showCc"
              @add-tag="addTagChange($event, 'cc')"
              tag-type="primary"
              @input="inputChange($event, 'cc')"
              size="default"
              v-model="form.cc"
          >
            <template #prefix>
              <div class="item-title">{{ $t('cc') }}</div>
              <el-select
                  ref="ccSelect"
                  class="write-select"
                  popper-class="write-select"
                  :show-arrow="false"
                  :no-match-text="' '"
                  :no-data-text="' '"
                  @visible-change="selectStatusChange($event, 'cc')"
                  @change="selectChange($event, 'cc')"
              >
                <el-option
                    v-for="item in selectRecipientLists.cc"
                    :key="item"
                    :label="item"
                    :value="item"
                    style="color: #999896;"
                />
              </el-select>
            </template>
            <template #suffix>
              <div class="recipient-actions">
                <Icon icon="fa7-solid:user-plus" width="20" height="20" class="add-contact" @click.stop="openContacts('cc')" />
              </div>
            </template>
          </el-input-tag>

          <el-input-tag
              v-if="showBcc"
              @add-tag="addTagChange($event, 'bcc')"
              tag-type="primary"
              @input="inputChange($event, 'bcc')"
              size="default"
              v-model="form.bcc"
          >
            <template #prefix>
              <div class="item-title">{{ $t('bcc') }}</div>
              <el-select
                  ref="bccSelect"
                  class="write-select"
                  popper-class="write-select"
                  :show-arrow="false"
                  :no-match-text="' '"
                  :no-data-text="' '"
                  @visible-change="selectStatusChange($event, 'bcc')"
                  @change="selectChange($event, 'bcc')"
              >
                <el-option
                    v-for="item in selectRecipientLists.bcc"
                    :key="item"
                    :label="item"
                    :value="item"
                    style="color: #999896;"
                />
              </el-select>
            </template>
            <template #suffix>
              <div class="recipient-actions">
                <Icon icon="fa7-solid:user-plus" width="20" height="20" class="add-contact" @click.stop="openContacts('bcc')" />
              </div>
            </template>
          </el-input-tag>
        </div>
        <el-input v-model="form.subject" :placeholder="t('subject')" />
        <tinyEditor :def-value="defValue" ref="editor" @change="change" @focus="focusChange" />
        <div class="button-item">
          <div class="att-add" @click="chooseFile">
            <Icon icon="iconamoon:attachment-fill" width="24" height="24"/>
          </div>
          <div class="att-clear" @click="clearContent">
            <Icon icon="icon-park-outline:clear-format" width="24" height="24 "/>
          </div>
          <div class="att-list">
            <div class="att-item" v-for="(item,index) in form.attachments" :key="index">
              <Icon v-bind="getIconByName(item.filename)"/>
              <span class="att-filename">{{ item.filename }}</span>
              <span class="att-size">{{ formatBytes(item.size) }}</span>
              <Icon style="cursor: pointer;" icon="material-symbols-light:close-rounded" @click="delAtt(index)"
                    width="22" height="22"/>
            </div>
          </div>
          <div>
            <el-button type="primary" @click="sendEmail" v-if="form.sendType === 'reply'">{{ $t('reply') }}</el-button>
            <el-button type="primary" @click="sendEmail" v-else-if="form.sendType === 'forward'">{{ $t('forward') }}</el-button>
            <el-button type="primary" @click="sendEmail" v-else>{{ $t('send') }}</el-button>
          </div>
        </div>
      </div>
    </div>
    <el-dialog top="10vh" v-model="showContacts" @closed="clearSelectContact" :title="t('recentContacts')">
      <el-table ref="contactsTabRef" row-key="email" :data="contacts" style="height: 445px">
        <el-table-column type="selection" width="32" />
        <el-table-column property="email" :label="t('emailAccount')" >
          <template #default="props">
            <div class="email-row">{{ props.row.email }}</div>
          </template>
        </el-table-column>
        <el-table-column width="55" label="" >
          <template #default>
            <div style="display: flex;">
              <Icon icon="mage:user" style="color: var(--el-text-color-primary)" width="22" height="22" color="#606266" />
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="contacts-bottom">
        <el-button type="default" @click="deleteContact">{{t('clear')}}</el-button>
        <el-button type="primary" @click="chooseContact">{{t('selectContacts')}}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import { setAuthenticated } from "@/auth/session.js";
import tinyEditor from '@/components/tiny-editor/index.vue'
import {h, nextTick, onMounted, onUnmounted, reactive, ref, toRaw, computed} from "vue";
import {Icon} from "@iconify/vue";
import {useUserStore} from "@/store/user.js";
import {emailSend} from "@/request/email.js";
import {isEmail} from "@/utils/verify-utils.js";
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {fileToBase64, formatBytes} from "@/utils/file-utils.js";
import {getIconByName} from "@/utils/icon-utils.js";
import sendPercent from "@/components/send-percent/index.vue"
import {toOssDomain} from "@/utils/convert.js";
import {formatDetailDate} from "@/utils/day.js";
import {useSettingStore} from "@/store/setting.js";
import {userDraftStore} from "@/store/draft.js";
import {useWriterStore} from "@/store/writer.js";
import db from "@/db/db.js";
import dayjs from "dayjs";
import {useI18n} from "vue-i18n";
import router from "@/router/index.js";
import {ElMessageBox} from "element-plus";

defineExpose({
  open,
  openReply,
  openForward,
  openDraft
})

const {t} = useI18n()
const writerStore = useWriterStore();
const draftStore = userDraftStore()
const settingStore = useSettingStore()
const emailStore = useEmailStore();
const accountStore = useAccountStore()
const editor = ref({})
const userStore = useUserStore();
const show = ref(false);
const percent = ref(0)
let percentMessage = null
let sending = false
const defValue = ref('')
const contactsTabRef = ref({})
const showContacts = ref(false)
const toSelect = ref()
const ccSelect = ref()
const bccSelect = ref()
const showCc = ref(false)
const showBcc = ref(false)
const activeRecipientField = ref('receiveEmail')
const selectStatuses = reactive({ receiveEmail: false, cc: false, bcc: false })
const selectRecipientLists = reactive({ receiveEmail: [], cc: [], bcc: [] })
const backReply = reactive({
  receiveEmail: [],
  cc: [],
  bcc: [],
  subject: '',
  content: '',
  sendType: ''
})
const form = reactive({
  sendEmail: '',
  receiveEmail: [],
  cc: [],
  bcc: [],
  accountId: -1,
  name: '',
  subject: '',
  content: '',
  sendType: '',
  text: '',
  emailId: 0,
  attachments: [],
  draftId: null,
})

const recipientFields = ['receiveEmail', 'cc', 'bcc']

const contacts = computed(() => writerStore.sendRecipientRecord.map(item => ({email: item})))

function openContacts(field = 'receiveEmail') {
  activeRecipientField.value = field
  showContacts.value = true
  nextTick(() => {
    form[field].forEach(item => {
      if (writerStore.sendRecipientRecord.includes(item)) {
        contactsTabRef.value.toggleRowSelection({email: item});
      }
    })
  })
}

function deleteContact() {
  ElMessageBox.confirm(t('confirmDeletionOfContacts'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    const contactList = contactsTabRef.value.getSelectionRows().map(item => item.email);
    recipientFields.forEach(field => {
      form[field] = form[field].filter(item => !contactList.includes(item));
    })
    writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(item => !contactList.includes(item));
  })
}

function chooseContact() {
  const field = activeRecipientField.value
  const contactList = contactsTabRef.value.getSelectionRows().map(item => item.email);
  contactList.forEach(item => addRecipient(item, field))

  form[field] = form[field].filter(item => {
    return contactList.includes(item) || !writerStore.sendRecipientRecord.includes(item);
  });

  showContacts.value = false
}

function clearSelectContact() {
  contactsTabRef.value.clearSelection();
}

function getSelectRef(field) {
  if (field === 'cc') return ccSelect.value
  if (field === 'bcc') return bccSelect.value
  return toSelect.value
}

function selectChange(value, field = 'receiveEmail') {
  addRecipient(value, field)
}

function selectStatusChange(status, field = 'receiveEmail') {
  selectStatuses[field] = status
}

const openSelect = (field = 'receiveEmail') => {
  getSelectRef(field)?.toggleMenu?.()
}

function allRecipientEmails(exceptField = '') {
  return recipientFields
      .filter(field => field !== exceptField)
      .flatMap(field => form[field])
      .map(item => String(item).trim().toLowerCase())
}

function recipientExists(email, exceptField = '') {
  const normalized = String(email).trim().toLowerCase()
  return allRecipientEmails(exceptField).includes(normalized)
}

function addRecipient(value, field = 'receiveEmail') {
  const email = String(value || '').trim()
  if (!email || !isEmail(email)) return false
  if (recipientExists(email, field)) return false
  if (form[field].some(item => String(item).trim().toLowerCase() === email.toLowerCase())) return false
  form[field].push(email)
  return true
}

function inputChange(value, field = 'receiveEmail') {
  const currentValue = String(value || '').trim().toLowerCase()
  selectRecipientLists[field] = writerStore.sendRecipientRecord.filter(item => {
    const normalized = String(item).toLowerCase()
    return currentValue && !recipientExists(item) && !form[field].some(existing => String(existing).toLowerCase() === normalized) && normalized.startsWith(currentValue)
  }).slice(0, 10);

  if (!selectStatuses[field] && selectRecipientLists[field].length > 0) {
    openSelect(field)
  }

  if (selectStatuses[field] && selectRecipientLists[field].length === 0) {
    openSelect(field)
  }
}

function addTagChange(val, field = 'receiveEmail') {
  const emails = Array.from(new Set(
      String(val || '').split(/[,，;；]/).map(item => item.trim()).filter(Boolean)
  ));

  // el-input-tag inserts the raw value before emitting add-tag. Remove it and
  // re-add only validated, de-duplicated addresses.
  form[field].splice(form[field].length - 1, 1)

  let has = false
  let invalid = ''
  emails.forEach(email => {
    if (!isEmail(email)) {
      invalid = invalid || email
      return
    }
    if (addRecipient(email, field)) has = true
  })

  if (invalid) {
    ElMessage({
      message: t('invalidRecipientMsg', {email: invalid}),
      type: 'error',
      plain: true,
    })
  }
  if (selectStatuses[field] && has) openSelect(field)
}

function normalizeRecipientFields() {
  const used = new Set()
  for (const field of recipientFields) {
    const normalized = []
    for (const raw of form[field] || []) {
      const email = String(raw || '').trim()
      if (!isEmail(email)) {
        ElMessage({
          message: t('invalidRecipientMsg', {email}),
          type: 'error',
          plain: true,
        })
        return false
      }
      const key = email.toLowerCase()
      if (used.has(key)) continue
      used.add(key)
      normalized.push(email)
    }
    form[field] = normalized
  }

  if (used.size > 100) {
    ElMessage({
      message: t('recipientLimitMsg'),
      type: 'error',
      plain: true,
    })
    return false
  }
  return true
}

function clearContent() {
  ElMessageBox.confirm(t('clearContentConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    resetForm()
  })

}

function delAtt(index) {
  form.attachments.splice(index, 1);
}

function chooseFile() {
  const doc = document.createElement("input")
  doc.setAttribute("type", "file")
  doc.multiple = true;
  doc.click()
  doc.onchange = async (e) => {

    const fileList = e.target.files;

    for (const file of fileList) {

      const size = file.size
      const filename = file.name
      const contentType = file.type

      const content = await fileToBase64(file)
      form.attachments.push({content, filename, size, contentType})

    }

  }
}

async function sendEmail() {

  if (!normalizeRecipientFields()) return

  if (form.receiveEmail.length === 0) {
    ElMessage({
      message: t('emptyRecipientMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!form.subject) {
    ElMessage({
      message: t('emptySubjectMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!form.content) {
    form.content = editor.value.getContent();
  }

  if (!form.content) {
    ElMessage({
      message: t('emptyContentMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.manyType === 'divide' && form.attachments.length > 0) {
    ElMessage({
      message: t('noSeparateSendMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (sending) {
    ElMessage({
      message: t('sendingErrorMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  percentMessage = ElMessage({
    message: () => h(sendPercent, {value: percent.value, desc: t('sending')}),
    plain: true,
    duration: 0,
    customClass: 'message-bottom'
  })

  sending = true

  show.value = false

  emailSend(form, (e) => {
    percent.value = Math.round((e.loaded * 98) / e.total)
  }).then(emailList => {
    const email = emailList[0]
    emailList.forEach(item => {
      emailStore.sendScroll?.addItem(item)
    })

    ElNotification({
      title: t('sendSuccessMsg'),
      type: "success",
      message: h('span', {style: 'color: teal'}, email.subject),
      position: 'bottom-right'
    })

    userStore.refreshUserInfo();

    addRecipientRecord();

    if (form.draftId) {
      form.subject = ''
      form.content = ''
      form.receiveEmail = []
      form.cc = []
      form.bcc = []
      draftStore.setDraft = {...toRaw(form)}
    }

    show.value = false
    resetForm();
  }).catch((e) => {
    ElNotification({
      title: t('sendFailMsg'),
      type: e.code === 403 ? 'warning' : 'error',
      message: h('span', {style: 'color: teal'}, e.message),
      position: 'bottom-right'
    })
    if (e.code === 401) {
      setAuthenticated(false);
      router.replace('/login');
    }
    show.value = true
    addRecipientRecord();
  }).finally(() => {
    percentMessage.close()
    percent.value = 0
    sending = false
  })
}

function addRecipientRecord() {
  const recipients = recipientFields
      .flatMap(field => form[field])
      .filter(Boolean)
      .filter((email, index, list) => list.findIndex(item => String(item).toLowerCase() === String(email).toLowerCase()) === index)

  const currentKeys = new Set(recipients.map(email => String(email).toLowerCase()))
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(
      email => !currentKeys.has(String(email).toLowerCase())
  );

  writerStore.sendRecipientRecord.unshift(...recipients);
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.slice(0, 500);
}

function resetForm() {
  form.receiveEmail = []
  form.cc = []
  form.bcc = []
  showCc.value = false
  showBcc.value = false
  recipientFields.forEach(field => {
    selectStatuses[field] = false
    selectRecipientLists[field] = []
  })
  form.subject = ''
  form.content = ''
  form.manyType = null
  form.attachments = []
  form.sendType = ''
  form.emailId = 0
  form.draftId = null
  backReply.content = ''
  backReply.subject = ''
  backReply.receiveEmail = []
  backReply.cc = []
  backReply.bcc = []
  backReply.sendType = ''
  editor.value.clearEditor()
}

function change(content, text) {
  form.content = content;
  form.text = text
}

function focusChange() {
  recipientFields.forEach(field => {
    if (selectStatuses[field]) openSelect(field)
  })
}

function openForward(email) {
  resetForm();

  email.subject = email.subject || ''

  form.subject = email.subject
  form.sendType = 'forward'

  defValue.value = ''

  setTimeout(() => {
    defValue.value = `
      ${formatImage(email.content) || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${email.text}</pre>`}
    `
    open()

    nextTick(() => {
      backReply.content = editor.value.getContent()
      backReply.subject = form.subject
      backReply.receiveEmail = [...form.receiveEmail]
      backReply.cc = [...form.cc]
      backReply.bcc = [...form.bcc]
      backReply.sendType = form.sendType
    })

  });
}

function openReply(email) {

  resetForm();

  email.subject = email.subject || ''

  form.receiveEmail.push(email.sendEmail)
  form.subject = (
      email.subject.startsWith('Re:') ||
      email.subject.startsWith('Re：') ||
      email.subject.startsWith('回复：') ||
      email.subject.startsWith('回复:')) ? email.subject : 'Re: ' + email.subject
  form.sendType = 'reply'
  form.emailId = email.emailId

  defValue.value = ''

  setTimeout(() => {
    defValue.value = `
    <div></div>
    <div>
    <br>
        ${formatDetailDate(email.createTime)} ${email.name} &lt${email.sendEmail}&gt ${t('wrote')}:
    </div>
    <blockquote class="mceNonEditable" style="margin: 0 0 0 0.8ex;border-left: 1px solid rgb(204,204,204);padding-left: 1ex;">
      <articl>
          ${formatImage(email.content) || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${email.text}</pre>`}
      </article>
    </blockquote>`
    open()

    nextTick(() => {
      backReply.content = editor.value.getContent()
      backReply.subject = form.subject
      backReply.receiveEmail = [...form.receiveEmail]
      backReply.cc = [...form.cc]
      backReply.bcc = [...form.bcc]
      backReply.sendType = form.sendType
    })
  })

}

function formatImage(content) {
  content = content || '';
  const domain = settingStore.settings.r2Domain;
  return content.replace(/{{domain}}/g, toOssDomain(domain) + '/');
}

function open() {
  if (!accountStore.currentAccount.email) {
    form.sendEmail = userStore.user.email;
    form.accountId = userStore.user.account.accountId;
    form.name = userStore.user.name;
  } else {
    form.sendEmail = accountStore.currentAccount.email;
    form.accountId = accountStore.currentAccount.accountId;
    form.name = accountStore.currentAccount.name;
  }
  show.value = true;
  editor.value.focus()
}

function toDraftRecipientList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map(item => typeof item === 'string' ? item : item?.address).filter(Boolean)
    }
  } catch (_) {
    // Older local drafts may contain a single string value.
  }
  return String(value).split(/[,，;；]/).map(item => item.trim()).filter(Boolean)
}

function openDraft(draft) {
  resetForm()
  Object.assign(form, {
    ...draft,
    receiveEmail: toDraftRecipientList(draft.receiveEmail),
    cc: toDraftRecipientList(draft.cc),
    bcc: toDraftRecipientList(draft.bcc),
    attachments: Array.isArray(draft.attachments) ? draft.attachments : []
  })
  showCc.value = form.cc.length > 0
  showBcc.value = form.bcc.length > 0
  defValue.value = ''
  setTimeout(() => defValue.value = form.content || '')
  show.value = true;
  editor.value.focus()
}

const handleKeyDown = (event) => {
  if (event.key === 'Escape') {
    close()
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

function sameRecipientList(left = [], right = []) {
  if (left.length !== right.length) return false
  return left.every((item, index) => String(item).toLowerCase() === String(right[index] || '').toLowerCase())
}

function close() {

  recipientFields.forEach(field => {
    if (selectStatuses[field]) openSelect(field)
  });

  if (!form.content) {
    form.content = editor.value.getContent();
  }

  if (form.draftId) {
    draftStore.setDraft = {...toRaw(form)}
    show.value = false
    resetForm()
    return;
  }

  if (!(form.content || form.subject || form.receiveEmail.length > 0 || form.cc.length > 0 || form.bcc.length > 0)) {
    show.value = false
    resetForm()
    return;
  }

  if (backReply.sendType === 'reply' || backReply.sendType === 'forward') {
    let subjectFlag = form.subject === backReply.subject
    let contentFlag = editor.value.getContent() === backReply.content
    let receiveFlag = sameRecipientList(form.receiveEmail, backReply.receiveEmail)
    let ccFlag = sameRecipientList(form.cc, backReply.cc)
    let bccFlag = sameRecipientList(form.bcc, backReply.bcc)
    if (backReply.sendType === 'forward' && form.receiveEmail.length === 0) {
      receiveFlag = backReply.receiveEmail.length === 0;
    }
    if (subjectFlag && contentFlag && receiveFlag && ccFlag && bccFlag) {
      resetForm();
      close()
      return;
    }
  }

  ElMessageBox.confirm(t('saveDraftConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning',
    distinguishCancelAndClose: true
  }).then(async () => {
    const formData = {...toRaw(form)};
    delete formData.draftId
    delete formData.attachments
    formData.createTime = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
    const draftId = await db.value.draft.add({...formData})
    db.value.att.add({draftId, attachments: toRaw(form.attachments)})
    draftStore.refreshList++
    show.value = false
    await nextTick(() => {
      resetForm()
    })
  }).catch((action) => {
    if (action === 'cancel') {
      show.value = false
      resetForm()
    }
  })

}

</script>
<style>
.write-select .el-select-dropdown__list {
  padding: 4px 4px !important;
}
.write-select .el-select-dropdown__item {
  padding: 0 10px 0 10px;
}

.write-select .el-select-dropdown {
  min-width: 0 !important;
}
</style>
<style scoped lang="scss">
.send {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  .write-box {
    background: var(--el-bg-color);
    width: min(1367px, calc(100% - 80px));
    box-shadow: var(--el-box-shadow-light);
    border: 1px solid var(--el-border-color-light);
    transition: var(--el-transition-duration);
    padding: 15px;
    border-radius: 8px;
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    @media (max-width: 1024px) {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: 0;
      padding-top: 10px;
    }

    @media (min-width: 1025px) {
      height: min(800px, calc(100vh - 60px));
    }

    .title {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;

      .title-left {
        align-items: center;
        display: grid;
        grid-template-columns: auto auto auto 1fr;
      }

      .title-text {
      }

      .sender {
        margin-left: 8px;
      }

      .sender-name {
        margin-left: 8px;
        font-weight: bold;
      }

      .send-email {
        color: #999896;
        margin-left: 5px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }


      div {
        display: flex;
        align-items: center;
      }
    }

    .container {
      height: 100%;
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: 15px;

      .item-title {
        min-width: 48px;
      }

      .recipient-fields {
        display: grid;
        gap: 8px;
      }

      .recipient-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-right: 3px;
      }

      .recipient-toggle {
        border: 0;
        padding: 2px 4px;
        background: transparent;
        color: var(--el-text-color-secondary);
        cursor: pointer;
        font: inherit;
        border-radius: 4px;

        &:hover,
        &.active {
          color: var(--el-color-primary);
          background: var(--el-fill-color-light);
        }
      }

      .button-item {
        display: grid;
        grid-template-columns: auto auto 1fr auto;

        .att-add {
          cursor: pointer;
        }

        .att-clear {
          cursor: pointer;
          margin-left: 10px;
        }

        .att-list {
          display: grid;
          gap: 5px;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          padding-left: 10px;
          padding-right: 10px;
          max-height: 110px;
          overflow-y: auto;
          @media (max-width: 450px) {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          }

          .att-item {
            display: grid;
            grid-template-columns: auto 1fr auto auto;
            gap: 5px;
            height: 32px;
            font-size: 14px;
            padding: 4px 5px;
            background: var(--light-ill);
            border-radius: 4px;
            .att-filename {
              white-space: nowrap;
              text-overflow: ellipsis;
              overflow: hidden;
            }
          }
        }
      }
    }
  }

}

.email-row {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.el-dialog) {
  width: 420px !important;
  @media (max-width: 460px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}

.contacts-bottom {
  display: flex;
  justify-content: end;
  margin-top: 10px;
}

.add-contact {
  color: var(--regular-text-color)
}

.write-select {
  position: absolute;
  width: 300px;
  left: 60px;
  z-index: 0;
  opacity: 0;
  pointer-events: none;
}

:deep(.el-input-tag__suffix) {
  padding-right: 4px;
}

.icon {
  cursor: pointer;
}
</style>
