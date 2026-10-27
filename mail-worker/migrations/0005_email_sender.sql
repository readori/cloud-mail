-- 上游 cloud-mail v3.4：信封发件人(SMTP MAIL FROM)，用于显示代发地址。
ALTER TABLE email ADD COLUMN sender_email TEXT NOT NULL DEFAULT '';
