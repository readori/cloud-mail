import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'docs/design-tokens.json'), 'utf8'));
const swift = fs.readFileSync(path.join(root, 'mail-ios/DesignSystem/Tokens/DMDesignTokens.swift'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mail-vue/src/design-tokens.css'), 'utf8');
const expected = {
  'spacing.xxs': ['xxs', tokens.spacing.xxs], 'spacing.md': ['md', tokens.spacing.md],
  'spacing.page': ['page', tokens.spacing.page], 'radius.input': ['input', tokens.radius.input],
  'radius.card': ['card', tokens.radius.card], 'control.minimumTapTarget': ['minimumTapTarget', tokens.control.minimumTapTarget]
};
for (const [name,[swiftName,value]] of Object.entries(expected)) {
  if (!new RegExp(`static let ${swiftName}: CGFloat = ${value}(?:\\.0)?\\b`).test(swift)) throw new Error(`Swift token drift: ${name}`);
}
for (const [name,value] of Object.entries(tokens.spacing)) {
  if (!css.includes(`--cf-space-${name}: ${value}px`)) throw new Error(`Web spacing token drift: ${name}`);
}
for (const theme of ['polar','mono','oled']) if (!css.includes(`data-cf-theme="${theme}"`)) throw new Error(`Missing web theme: ${theme}`);
console.log('✅ Shared iOS/Web design token contract PASS');
