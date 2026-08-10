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
const app = createApp(App).use(pinia)
await init()
const uiStore = useUiStore(pinia)
const applyThemePreset = () => { document.documentElement.dataset.cfTheme = uiStore.themePreset || 'polar' }
applyThemePreset()
uiStore.$subscribe(applyThemePreset)
app.use(router).use(i18n).directive('perm',perm)
app.config.devtools = true;

app.mount('#app');
