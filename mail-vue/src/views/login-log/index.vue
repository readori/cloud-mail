<template>
  <div class="login-log">
    <div class="header-actions">
      <div class="search">
        <el-input v-model="params.keyword" class="search-input" clearable
                  :placeholder="$t('searchLoginLog')" @keyup.enter="search" @clear="search"/>
      </div>
      <Icon class="icon" icon="iconoir:search" width="20" height="20" @click="search"/>
      <Icon class="icon" icon="ion:reload" width="18" height="18" @click="getList"/>
    </div>

    <div class="table-box">
      <el-table :data="list" height="100%" v-loading="loading" element-loading-background="transparent"
                :empty-text="loading ? '' : $t('noLoginLog')">
        <el-table-column :label="$t('loginTime')" :width="165">
          <template #default="props">{{ tzDayjs(props.row.createTime).format('YYYY-MM-DD HH:mm:ss') }}</template>
        </el-table-column>
        <el-table-column :label="$t('emailAccount')" min-width="200" show-overflow-tooltip>
          <template #default="props">{{ props.row.email || $t('deleted') }}</template>
        </el-table-column>
        <el-table-column :label="$t('loginIp')" min-width="170">
          <template #default="props">
            <div class="ip">{{ props.row.ip || $t('unknown') }}</div>
            <div class="sub" v-if="props.row.country || props.row.city">
              {{ [props.row.country, props.row.city].filter(Boolean).join(' · ') }}
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('loginDevice')" min-width="190">
          <template #default="props">
            <div>{{ [props.row.device, props.row.os].filter(Boolean).join(' / ') || $t('unknown') }}</div>
            <div class="sub">{{ props.row.browser }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('loginMethod')" :width="90">
          <template #default="props">
            <el-tag disable-transitions :type="props.row.method === 'oauth' ? 'success' : 'primary'">
              {{ props.row.method === 'oauth' ? $t('loginByOauth') : $t('loginByPassword') }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pagination">
      <el-pagination
          :disabled="loading"
          background
          layout="total, prev, pager, next"
          :pager-count="5"
          :page-size="params.size"
          :current-page="params.num"
          :total="total"
          @current-change="pageChange"
      />
    </div>
  </div>
</template>

<script setup>
import {defineOptions, onMounted, reactive, ref} from 'vue'
import {Icon} from '@iconify/vue'
import {loginLogList} from '@/request/login-log.js'
import {tzDayjs} from '@/utils/day.js'

defineOptions({
  name: 'login-log'
})

const list = reactive([])
const total = ref(0)
const loading = ref(false)
const params = reactive({keyword: '', num: 1, size: 20})

function getList() {
  loading.value = true
  loginLogList({...params}).then(data => {
    list.length = 0
    list.push(...(data?.list || []))
    total.value = data?.total || 0
  }).finally(() => {
    loading.value = false
  })
}

function search() {
  params.num = 1
  getList()
}

function pageChange(num) {
  params.num = num
  getList()
}

onMounted(getList)
</script>

<style scoped lang="scss">
.login-log {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--settings-page-background);
}

.header-actions {
  padding: 9px 15px;
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  align-items: center;
  box-shadow: inset 0 -1px 0 0 rgba(100, 121, 143, 0.12);
  font-size: 18px;
  background: var(--el-bg-color);
  @media (max-width: 767px) {
    gap: 12px;
  }

  .search-input {
    width: min(320px, calc(100vw - 110px));
  }

  .search {
    :deep(.el-input__wrapper) {
      height: 28px;
    }
  }

  .icon {
    cursor: pointer;
  }
}

.table-box {
  flex: 1;
  min-height: 0;
  padding: 0 15px;
  background: var(--el-bg-color);

  .ip {
    font-family: var(--el-font-family);
    word-break: break-all;
  }

  .sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.pagination {
  display: flex;
  justify-content: flex-end;
  padding: 10px 15px;
  background: var(--el-bg-color);
}
</style>
