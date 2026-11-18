import { createScene } from './scene.mjs'
import * as V from './vault.mjs'

const $ = (s, r = document) => r.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const short = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`

// ------------------------------------------------------------ story + 3D
let stage = null
try {
  stage = createScene($('#stage'))
} catch {
  $('#stage').remove() // no WebGL: the page still works
}
const chapters = [...document.querySelectorAll('.chapter')]
function onScroll() {
  const mid = innerHeight / 2
  let p = 0
  chapters.forEach((c, i) => {
    const r = c.getBoundingClientRect()
    if (r.top + r.height / 2 <= mid) p = i + Math.min(1, (mid - (r.top + r.height / 2)) / r.height)
  })
  stage?.setProgress(Math.min(p, chapters.length - 1 + 0.4))
  const first = $('.pieces').getBoundingClientRect().top
  document.body.classList.toggle('sheets', first < innerHeight * 0.55)
}
addEventListener('scroll', onScroll, { passive: true })
onScroll()
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.35 })
chapters.forEach((c) => io.observe(c))

// ------------------------------------------------------------ attack button
$('#attackBtn').onclick = async (e) => {
  const b = e.currentTarget
  const out = $('#attackOut')
  b.disabled = true
  out.textContent = 'Forging a signature and sending it to Aevum…'
  try {
    const r = await V.attack('forge')
    out.innerHTML = r.blocked
      ? `<span class="stamp">Blocked</span>QSafe rejected the forged payment. The demo vault still holds <b>${V.fmt(r.balance)} tUSD8</b>.`
      : esc(r.message)
  } catch (err) {
    out.textContent = err.message
  }
  b.disabled = false
}

// ------------------------------------------------------------ proof
V.config().catch(() => null)
fetch('/api/proof')
  .then((r) => r.json())
  .then((p) => {
    $('#txs').innerHTML = p.txs
      .map((t) => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener"><span class="what">${esc(t.step)}</span><span class="tag ${t.attack ? 'block' : ''}">${t.attack ? 'Blocked' : `${(t.gas / 1000).toFixed(0)}k gas`}</span></a></li>`)
      .join('')
    $('#contracts').innerHTML = `QSafe <a href="${p.explorer}/address/${p.qsafe}" target="_blank" rel="noopener">${short(p.qsafe)}</a> · tUSD8 <a href="${p.explorer}/address/${p.token}" target="_blank" rel="noopener">${short(p.token)}</a> · chain 44005`
  })
  .catch(() => ($('#txs').innerHTML = '<li class="muted center">Could not load the record.</li>'))

// ------------------------------------------------------------ the vault app
const app = $('#app')
let vault = V.load()
let tab = 'deposit'
const log = []

function welcome() {
  app.innerHTML = `
    <h3>Make your quantum key</h3>
    <p>We create a secret on this device and open a QSafe account for it on Aevum. You pay no gas.</p>
    <button class="pill wide" id="create">Create my vault</button>
    <div class="status" id="st"></div>
    <details><summary>I already have a recovery code</summary>
      <label for="code">Recovery code</label><textarea id="code" rows="3" placeholder="qsafe:…"></textarea>
      <button class="pill ghost wide" id="restore">Restore vault</button>
    </details>`
  $('#create').onclick = async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    status('Creating keys on your device and opening your account…')
    try {
      const r = await V.create()
      vault = r.vault
      log.unshift({ what: 'Account opened', url: r.tx.explorer })
      render(true)
    } catch (err) {
      status(err.message, true)
      btn.disabled = false
    }
  }
  $('#restore').onclick = () => {
    try {
      vault = V.importCode($('#code').value)
      render()
    } catch (err) {
      status(err.message, true)
    }
  }
}

function status(msg, err = false, html = false) {
  const s = $('#st')
  if (!s) return
  s.className = `status${err ? ' err' : ''}`
  s[html ? 'innerHTML' : 'textContent'] = msg
}

async function render(fresh = false) {
  if (!vault) return welcome()
  let a = { exists: false, balance: '0', nonce: 0 }
  try {
    a = await V.account(vault)
  } catch {}
  app.innerHTML = `
    <div class="row split"><span class="chip live">Quantum-safe</span><span class="chip" id="copyId" title="Copy account id">Account ${short(vault.accountId)} ⧉</span></div>
    <div class="balance">${V.fmt(a.balance)}<small>tUSD8</small></div>
    <p class="muted" style="margin:0">${a.exists ? `One-time key #${a.nonce + 1} is ready. ${a.nonce} used and retired.` : 'Account is opening…'}</p>
    <div class="secret hidden" id="secret">
      <div class="row split"><b style="font-size:13px">Recovery code</b><span style="font-size:12px;opacity:.7">Anyone with this can spend</span></div>
      <div class="mono" style="margin-top:8px">${V.recoveryCode(vault)}</div>
      <div class="row"><span class="chip" id="reveal">Show</span><span class="chip" id="copyCode">Copy</span></div>
    </div>
    ${fresh ? '<p class="status">Save your recovery code now. We can’t recover it for you.</p>' : ''}
    <div class="tabs"><button data-t="deposit" class="${tab === 'deposit' ? 'on' : ''}">Add money</button><button data-t="pay" class="${tab === 'pay' ? 'on' : ''}">Pay</button></div>
    <div id="pane"></div>
    <div class="steps" id="steps"><i></i><i></i><i></i></div>
    <div class="status" id="st"></div>
    ${log.length ? `<details open><summary>This session</summary><ul class="activity">${log.map((l) => `<li><span>${esc(l.what)}</span><a href="${esc(l.url)}" target="_blank" rel="noopener">View ↗</a></li>`).join('')}</ul></details>` : ''}
    <details><summary>Use a different vault</summary><p class="muted" style="font-size:14px">This removes the vault from this browser. Copy your recovery code first.</p><button class="pill ghost" id="forget">Forget this device’s vault</button></details>`
  pane()
  app.querySelectorAll('.tabs button').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.t
        app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b))
        steps(-1)
        status('')
        pane()
      }),
  )
  $('#reveal').onclick = () => $('#secret').classList.toggle('hidden')
  $('#copyCode').onclick = () => navigator.clipboard?.writeText(V.recoveryCode(vault)).then(() => status('Recovery code copied.'))
  $('#copyId').onclick = () => navigator.clipboard?.writeText(vault.accountId).then(() => status('Account id copied. Others can pay this vault with it.'))
  $('#forget').onclick = () => {
    if (!confirmForget()) return
    localStorage.removeItem('qsafe.vault.v1')
    vault = null
    render()
  }
}
let forgetArmed = false
function confirmForget() {
  if (forgetArmed) return true
  forgetArmed = true
  $('#forget').textContent = 'Tap again to forget it'
  setTimeout(() => (forgetArmed = false), 4000)
  return false
}

function steps(n) {
  app.querySelectorAll('#steps i').forEach((el, i) => (el.className = i < n ? 'done' : i === n ? 'on' : ''))
}

function pane() {
  const p = $('#pane')
  if (tab === 'deposit') {
    p.innerHTML = `
      <p style="margin:0">Move tUSD8 from any wallet. You sign one message; our relayer pays the gas.</p>
      <label for="amt">Amount</label><input id="amt" inputmode="decimal" value="1" />
      <button class="pill wide" id="go">Connect wallet & add</button>
      <p class="muted" style="font-size:13px;margin:10px 0 0">Need test tUSD8? Claim it from the QDay faucet in their Discord.</p>`
    $('#go').onclick = async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        steps(0)
        status('Opening your wallet…')
        await V.connectWallet()
        steps(1)
        status('Sign the deposit in your wallet…')
        const r = await V.deposit(vault, $('#amt').value)
        steps(3)
        log.unshift({ what: `Added ${$('#amt').value} tUSD8`, url: r.explorer })
        await render()
        status(`Done. <a href="${r.explorer}" target="_blank" rel="noopener">See it on Aevum ↗</a>`, false, true)
      } catch (err) {
        status(err.shortMessage ?? err.message, true)
        btn.disabled = false
      }
    }
  } else {
    p.innerHTML = `
      <p style="margin:0">Signed on this device with your one-time hash key. Paste a 0x address, or a QSafe account id to keep it quantum-safe.</p>
      <label for="to">To</label><input id="to" placeholder="0x… address or QSafe account" autocomplete="off" />
      <label for="amt">Amount</label><input id="amt" inputmode="decimal" placeholder="0.10" />
      <button class="pill lime wide" id="go">Sign & pay</button>`
    $('#go').onclick = async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        let n = 0
        const r = await V.pay(vault, { to: $('#to').value, amount: $('#amt').value }, (msg) => (steps(n++), status(msg)))
        steps(3)
        log.unshift({ what: `Paid ${$('#amt').value} tUSD8 with key #${r.keyIndex + 1}`, url: r.explorer })
        await render()
        status(`Paid with a ${r.sig.length}-part hash signature · ${(Number(r.gasUsed) / 1000).toFixed(0)}k gas. <a href="${r.explorer}" target="_blank" rel="noopener">View ↗</a>`, false, true)
      } catch (err) {
        status(err.message, true)
        btn.disabled = false
      }
    }
  }
}

render()
