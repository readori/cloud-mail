import {useUserStore} from "@/store/user.js";
import {useSettingStore} from "@/store/setting.js";
import {useAccountStore} from "@/store/account.js";
import {loginUserInfo} from "@/request/my.js";
import {permsToRouter} from "@/perm/perm.js";
import router from "@/router";
import {websiteConfig} from "@/request/setting.js";
import i18n from "@/i18n/index.js";
import { purgeLegacyAuthToken, setAuthenticated } from "@/auth/session.js";

export async function init() {
    document.title = '\u200B'
    purgeLegacyAuthToken()

    const settingStore = useSettingStore();
    const userStore = useUserStore();
    const accountStore = useAccountStore();

    if (!settingStore.lang) {
        let lang = navigator.language.split('-')[0]
        lang = lang === 'zh' ? lang : 'en'
        settingStore.lang = lang
    }
    i18n.global.locale.value = settingStore.lang

    const userPromise = loginUserInfo(true).catch(() => null)
    const [setting, user] = await Promise.all([websiteConfig(), userPromise])
    settingStore.settings = setting
    settingStore.domainList = setting.domainList
    document.title = setting.title

    if (!user) {
        setAuthenticated(false)
        userStore.user = {}
        return
    }

    setAuthenticated(true)
    accountStore.currentAccountId = user.account.accountId
    accountStore.currentAccount = user.account
    userStore.user = user
    const routers = permsToRouter(user.permKeys)
    routers.forEach(routerData => router.addRoute('layout', routerData))
}
