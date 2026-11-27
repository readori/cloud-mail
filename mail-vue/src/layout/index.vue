<template>
  <div v-if="uiStore.impersonation.impersonating" class="impersonation-bar">
    <Icon icon="material-symbols:supervised-user-circle" width="18" height="18" />
    <span class="impersonation-text">{{ $t('impersonating', { email: uiStore.impersonation.target?.email || '' }) }}</span>
    <el-button size="small" round :loading="stopping" @click="returnToAdmin">{{ $t('returnToAdmin') }}</el-button>
  </div>
  <el-container class="layout" :class="{ 'has-impersonation-bar': uiStore.impersonation.impersonating }">
    <el-aside
        class="aside"
        :class="uiStore.asideShow ? 'aside-show' : 'el-aside-hide'">
      <Aside />
    </el-aside>
    <div
        :class="(uiStore.asideShow && isMobile)? 'overlay-show':'overlay-hide'"
        @click="uiStore.asideShow = false"
    ></div>
    <el-container class="main-container">
      <el-main>
        <el-header>
            <Header />
        </el-header>
        <Main />
      </el-main>
    </el-container>
  </el-container>
  <writer ref="writerRef" />
</template>

<script setup>
import Aside from '@/layout/aside/index.vue'
import Header from '@/layout/header/index.vue'
import Main from '@/layout/main/index.vue'
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {useUiStore} from "@/store/ui.js";
import writer from '@/layout/write/index.vue'
import {Icon} from "@iconify/vue";
import {impersonateStop} from "@/request/impersonate.js";
import {diag} from "@/diagnostics/logger.js";
import {ElMessage} from "element-plus";
import {useI18n} from 'vue-i18n';

const uiStore = useUiStore();
const {t} = useI18n();
const stopping = ref(false);

async function returnToAdmin() {
  if (stopping.value) return;
  stopping.value = true;
  try {
    diag.info('impersonate', 'stop requested');
    await impersonateStop();
    diag.info('impersonate', 'stop ok, reloading');
    window.location.reload();
  } catch (e) {
    diag.error('impersonate', 'stop failed', { message: e && (e.message || (e.response && e.response.data && e.response.data.message)) });
    stopping.value = false;
    ElMessage({ message: e?.response?.data?.message || e?.message || t('returnToAdminFailed'), type: 'error', plain: true });
  }
}
const writerRef = ref({})
const isMobile = ref(window.innerWidth < 1025)
const handleResize = () => {
  isMobile.value = window.innerWidth < 1025
  uiStore.asideShow = window.innerWidth > 1024;
}

onMounted(() => {
  uiStore.writerRef = writerRef

  window.addEventListener('resize', handleResize)
  handleResize()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style lang="scss" scoped>
.el-aside-hide {
  position: fixed;
  left: 0;
  height: 100%;
  z-index: 100;
  transform: translateX(-100%);
  transition: all 100ms ease;
}

.aside-show {
  -webkit-box-shadow: var(--aside-right-border);
  box-shadow: var(--aside-right-border);
  transform: translateX(0);
  transition: all 100ms ease;
  z-index: 101;
  @media (max-width: 1025px) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 101;
    height: 100%;
    background: var(--el-bg-color);
  }
}

.el-aside {
  width: auto;
  transition: all 100ms ease;
}

.layout {
  height: 100%;
  position: fixed;
  width: 100%;
  top: 0;
  left: 0;
  overflow: hidden;
}

.main-container {
  min-height: 100%;
  background: var(--el-bg-color);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.el-main {
  padding: 0;
}

.el-header {
  background: var(--el-bg-color);
  border-bottom: solid 1px var(--el-border-color);
  padding: 0 0 0 0;
  @media (max-width: 767px) {
    height: 50px;
  }
}

.overlay-show {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  z-index: 99;
  transition: all 0.3s;
}

.overlay-hide {
  display: flex;
  pointer-events: none;
  opacity: 0;
}
</style>
<style scoped>
.impersonation-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3000;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  color: #fff;
  background: linear-gradient(90deg, var(--el-color-warning), var(--el-color-warning-dark-2, #b88230));
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
}
.impersonation-text {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.layout.has-impersonation-bar {
  padding-top: 40px;
  box-sizing: border-box;
}
</style>
