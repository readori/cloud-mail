<template>
  <el-scrollbar class="scroll">
    <div>
      <div class="title" >
        <Icon icon="mdi:email-outline" width="24" height="24" />
        <div>{{settingStore.settings.title}}</div>
      </div>
      <div v-if="adminAvailable" class="workspace-switch" role="group" :aria-label="$t('workspaceSwitcher')">
        <button
            type="button"
            class="workspace-button"
            :class="{ active: currentWorkspace === 'mail' }"
            :aria-pressed="currentWorkspace === 'mail'"
            @click="openMailWorkspace"
        >
          <Icon icon="hugeicons:mailbox-01" width="17" height="17" />
          <span>{{ $t('workspaceMail') }}</span>
        </button>
        <button
            type="button"
            class="workspace-button"
            :class="{ active: currentWorkspace === 'admin' }"
            :aria-pressed="currentWorkspace === 'admin'"
            @click="openAdminWorkspace"
        >
          <Icon icon="fluent:shield-person-20-regular" width="17" height="17" />
          <span>{{ $t('workspaceAdmin') }}</span>
        </button>
      </div>
      <el-menu :collapse="false" text-color="#fff" active-text-color="#fff" style="margin-top: 10px">
        <template v-if="currentWorkspace === 'mail'">
          <el-menu-item @click="router.push({name: 'email'})" index="email"
                        :class="route.meta.name === 'email' ? 'choose-item' : ''">
            <Icon icon="hugeicons:mailbox-01" width="20" height="20" />
            <span class="menu-name" style="margin-left: 21px">{{$t('inbox')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'send'})" index="send" v-perm="'email:send'"
                        :class="route.meta.name === 'send' ? 'choose-item' : ''">
            <Icon icon="cil:send" width="20" height="20" />
            <span class="menu-name" style="margin-left: 21px">{{$t('sent')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'draft'})" index="draft" v-perm="'email:send'"
                        :class="route.meta.name === 'draft' ? 'choose-item' : ''">
            <Icon icon="ep:document" width="19" height="19" />
            <span class="menu-name" style="margin-left: 22px">{{$t('drafts')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'star'})" index="star"
                        :class="route.meta.name === 'star' ? 'choose-item' : ''">
            <Icon icon="solar:star-line-duotone" width="20" height="20" />
            <span class="menu-name" style="margin-left: 21px">{{$t('starred')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'setting'})" index="setting"
                        :class="route.meta.name === 'setting' ? 'choose-item' : ''">
            <Icon icon="fluent:settings-48-regular" width="20" height="20" />
            <span class="menu-name" style="margin-left: 21px">{{$t('settings')}}</span>
          </el-menu-item>
        </template>

        <template v-else>
          <div class="manage-title">
            <div>{{$t('workspaceAdmin')}}</div>
          </div>
          <el-menu-item @click="router.push({name: 'analysis'})" index="analysis" v-perm="'analysis:query'"
                        :class="route.meta.name === 'analysis' ? 'choose-item' : ''">
            <Icon icon="fluent:data-pie-20-regular" width="24" height="24" />
            <span class="menu-name" style="margin-left: 18px">{{$t('analytics')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'user'})" index="user" v-perm="'user:query'"
                        :class="route.meta.name === 'user' ? 'choose-item' : ''">
            <Icon icon="si:user-alt-2-line" width="20" height="20" />
            <span class="menu-name" style="margin-left: 21px">{{$t('allUsers')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'all-email'})" index="all-email" v-perm="'all-email:query'"
                        :class="route.meta.name === 'all-email' ? 'choose-item' : ''">
            <Icon icon="fluent:mail-list-28-regular" width="22" height="22" />
            <span class="menu-name" style="margin-left: 20px">{{$t('allMail')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'role'})" index="role" v-perm="'role:query'"
                        :class="route.meta.name === 'role' ? 'choose-item' : ''">
            <Icon icon="fluent:lock-closed-16-regular" width="22" height="22" />
            <span class="menu-name" style="margin-left: 20px">{{$t('permissions')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'reg-key'})" index="reg-key" v-perm="'reg-key:query'"
                        :class="route.meta.name === 'reg-key' ? 'choose-item' : ''">
            <Icon icon="fluent:fingerprint-20-filled" width="22" height="22" />
            <span class="menu-name" style="margin-left: 20px">{{$t('inviteCode')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'sys-setting'})" index="sys-setting" v-perm="'setting:query'"
                        :class="route.meta.name === 'sys-setting' ? 'choose-item' : ''">
            <Icon icon="eos-icons:system-ok-outlined" width="18" height="18" style="margin-left: 2px" />
            <span class="menu-name" style="margin-left: 22px">{{$t('SystemSettings')}}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </div>
  </el-scrollbar>
</template>

<script setup>
import router from "@/router/index.js";
import { useRoute } from "vue-router";
import {Icon} from "@iconify/vue";
import {useSettingStore} from "@/store/setting.js";
import {computed} from "vue";
import {hasPerm} from "@/perm/perm.js";

const settingStore = useSettingStore();
const route = useRoute();

const adminPermissions = ['analysis:query', 'user:query', 'all-email:query', 'role:query', 'reg-key:query', 'setting:query'];
const adminAvailable = computed(() => adminPermissions.some(perm => hasPerm(perm)));
const currentWorkspace = computed(() => route.meta.workspace === 'admin' ? 'admin' : 'mail');

function openMailWorkspace() {
  router.push({name: 'email'});
}

function openAdminWorkspace() {
  const candidates = [
    ['analysis:query', 'analysis'],
    ['user:query', 'user'],
    ['all-email:query', 'all-email'],
    ['role:query', 'role'],
    ['reg-key:query', 'reg-key'],
    ['setting:query', 'sys-setting'],
  ];
  const target = candidates.find(([perm, name]) => hasPerm(perm) && router.hasRoute(name));
  if (target) router.push({name: target[1]});
}

</script>

<style lang="scss" scoped>

.title {
  margin: 15px 10px;
  height: 45px;
  border-radius: 6px;
  display: flex;
  position: relative;
  font-size: 16px;
  font-weight: bold;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: #ffffff;
  background: linear-gradient(135deg, #1890ff, #3a80dd);
  transition: all 0.3s ease;
  max-width: 240px;
  padding: 0 10px;
  > div {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: calc(240px - 20px - 30px);
  }

  :deep(.el-icon) {
    flex-shrink: 0;
    font-size: 20px;
  }

  .user-right-icon {
    align-self: center;
    position: absolute;
    font-size: 12px;
    right: 8px;
    color: #ffffff;
  }

}


.workspace-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 0 10px 8px;
  padding: 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: color-mix(in srgb, var(--aside-backgound) 92%, white 8%);
}

.workspace-button {
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--el-color-white);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.workspace-button.active {
  background: rgba(255, 255, 255, 0.14);
  font-weight: 700;
}

.workspace-button:focus-visible {
  outline: 2px solid var(--el-color-white);
  outline-offset: 2px;
}

.manage-title {
  margin-top: 10px;
  padding-left: 20px;
  color: #fff;
}

.el-menu-item {
  margin: 5px 10px !important;
  border-radius: 6px;
  height: 36px;
  padding: 10px !important;
}

.choose-item {
  font-weight: bold;
  background: rgba(255, 255, 255, 0.08) !important;
  backdrop-filter: blur(4px);
}

@media (hover: hover) {
  .el-menu-item:hover {
    background: rgba(255, 255, 255, 0.08) !important;
  }
}

.menu-name {
  user-select: none;
}


:deep(.el-scrollbar__wrap--hidden-default ) {
  background: var(--aside-backgound) !important;
}

:deep(.el-menu-item) {
  background: var(--aside-backgound);
}

:deep(.el-menu) {
  background: var(--aside-backgound);
}

.el-menu {
  border-right: 0;
  width: 260px;
}

:deep(.el-divider__text) {
  background: var(--aside-backgound);
  color: #FFFFFF;
}

.scroll {

}
</style>
