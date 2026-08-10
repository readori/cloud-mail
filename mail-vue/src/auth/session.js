let authenticated = false

export function setAuthenticated(value) {
  authenticated = value === true
}

export function isAuthenticated() {
  return authenticated
}

export function purgeLegacyAuthToken() {
  // One-way migration from pre-Phase-2 builds. Never read or write the legacy JWT again.
  localStorage.removeItem('token')
}

export function readCsrfToken() {
  const match = document.cookie
    .split(';')
    .map(item => item.trim())
    .find(item => item.startsWith('cfmail_csrf='))
  return match ? decodeURIComponent(match.slice('cfmail_csrf='.length)) : ''
}
