# CloudMail Public Documentation

This directory contains only documentation and assets required by users who self-host the public CloudMail Web/Worker stack.

## Documents

- [Self-Hosting Guide — English](./CloudMail-Self-Hosting-Deployment-Guide-EN.md)
- [自建部署指南 — 简体中文](./CloudMail-Self-Hosting-Deployment-Guide-ZH.md)
- [Cloudflare Deployment Guide (HTML)](./cloudmail-cloudflare-deploy-guide.html)

## Public deployment scope

The public deployment consists of:

```text
mail-vue/      Vue 3 Web client
mail-worker/   Cloudflare Worker backend, API and mail handler
.github/workflows/cloudflare-deploy.yml
```

The GitHub Actions workflow checks out the repository in which it runs and requires no extra source-repository token.

The optional hosted notification service can be enabled through `CFMAIL_PUSH_GATEWAY_URL`. Its implementation and infrastructure are not part of the public self-hosting package.
