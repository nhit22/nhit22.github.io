import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA1H38nzMRt3XPFWffv1_ryfn6Ot0xOSv0",
  authDomain: "nhit22.firebaseapp.com",
  projectId: "nhit22",
  storageBucket: "nhit22.firebasestorage.app",
  messagingSenderId: "206103449651",
  appId: "1:206103449651:web:96d0f0674d7240728d5346"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let isAdmin = false, transactions = [], members = [], memberNotes = {}, formerMembers = [];
let exemptMembers = ["김의수", "박소연", "정승희"];
let accountText = "카카오뱅크 3333360366378 정승희";
let duesMode = "monthly", txFilter = "all", draftPaid = {};

const CATEGORIES = {
  in: ["정기회비", "추가회비", "은행이자", "이월금", "기타수입"],
  out: ["결혼", "출산", "조의", "돌잔치", "모임/식비", "기타지출"]
};

const today = new Date();
document.getElementById("txDate").valueAsDate = today;
const monthSelector = document.getElementById("monthSelector");
monthSelector.value = today.toISOString().slice(0, 7);
monthSelector.onchange = () => { loadDraftForMonth(); renderMembers(); };
document.getElementById("yearSelector").onchange = () => renderMembers();

window.copyAccount = () => {
  navigator.clipboard.writeText(accountText);
  alert(`계좌정보 복사 완료:\n${accountText}`);
};

window.editAccountInfo = async () => {
  const nextAcc = prompt("변경할 모임통장 계좌정보를 입력하세요\n(예: 카카오뱅크 3333000000000 홍길동)", accountText);
  if (nextAcc === null) return;
  const trimmed = nextAcc.trim();
  if (!trimmed) return alert("계좌정보를 비워둘 수 없습니다.");
  try {
    await setDoc(doc(db, "config", "settings"), { accountText: trimmed }, { merge: true });
    alert("모임통장 계좌정보가 변경되었습니다.");
  } catch (e) {
    alert("계좌 변경 권한 오류: Firebase 규칙에서 config 쓰기 허용이 필요합니다.");
  }
};

window.updateCategoryOptions = () => {
  const type = document.getElementById("txType").value;
  document.getElementById("txCategory").innerHTML = CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join("");
};
updateCategoryOptions();

window.switchTab = (tab, btn) => {
  document.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-" + tab).classList.add("active");
};

window.setDuesMode = (mode) => {
  duesMode = mode;
  document.getElementById("viewMonthlyBtn").classList.toggle("active", mode === "monthly");
  document.getElementById("viewYearlyBtn").classList.toggle("active", mode === "yearly");
  document.getElementById("monthlyControls").style.display = mode === "monthly" ? "flex" : "none";
  document.getElementById("yearlyControls").style.display = mode === "yearly" ? "flex" : "none";
  document.getElementById("saveDuesBar").style.display = (mode === "monthly" && isAdmin) ? "block" : "none";
  renderMembers();
};

window.setTxFilter = (filter, btn) => {
  txFilter = filter;
  document.querySelectorAll("#tab-ledger .sub-seg-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderLedger();
};

document.getElementById("loginBtn").onclick = () => signInWithPopup(auth, provider);
document.getElementById("logoutBtn").onclick = () => signOut(auth);

onSnapshot(doc(db, "config", "settings"), (snap) => {
  if (snap.exists()) {
    const data = snap.data();
    if (data.exemptMembers) exemptMembers = data.exemptMembers;
    if (data.accountText) accountText = data.accountText;
  }
  document.getElementById("accountDisplay").textContent = accountText;
  document.getElementById("exemptNamesText").textContent = exemptMembers.join(", ") || "없음";
  renderExemptUI();
  renderMembers();
});

onAuthStateChanged(auth, async (user) => {
  const loginBtn = document.getElementById("loginBtn"), logoutBtn = document.getElementById("logoutBtn");
  const infoCard = document.getElementById("userInfoCard"), badge = document.getElementById("roleBadge");
  if (user) {
    loginBtn.style.display = "none"; logoutBtn.style.display = "inline-block"; infoCard.style.display = "block";
    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("userUid").textContent = user.uid;
    const adminSnap = await getDoc(doc(db, "config", "admin"));
    isAdmin = adminSnap.exists() && (adminSnap.data().uids || []).includes(user.uid);
  } else {
    loginBtn.style.display = "inline-block"; logoutBtn.style.display = "none"; infoCard.style.display = "none"; isAdmin = false;
  }
  badge.textContent = isAdmin ? "총무 모드" : "일반회원";
  badge.className = isAdmin ? "badge badge-paid" : "badge badge-exempt";
  document.querySelectorAll(".admin-only").forEach(el => {
    if (el.id === "saveDuesBar") el.style.display = (isAdmin && duesMode === "monthly") ? "block" : "none";
    else el.style.display = isAdmin ? (el.classList.contains("btn-group") ? "flex" : "block") : "none";
  });
  if (isAdmin) subscribeSecretData();
  renderLedger(); renderMembers();
});

window.editDirectBalance = async () => {
  const current = document.getElementById("totalBalance").textContent.replace(/[^0-9-]/g, "");
  const input = prompt("실제 모임통장 잔액(숫자만)을 입력하세요:", current);
  if (input === null) return;
  const targetVal = Number(input.replace(/,/g, ""));
  if (isNaN(targetVal)) return alert("올바른 숫자를 입력하세요.");
  const diff = targetVal - Number(current);
  if (diff === 0) return alert("현재 잔액과 동일합니다.");
  await addDoc(collection(db, "transactions"), {
    date: new Date().toISOString().slice(0, 10),
    type: diff > 0 ? "in" : "out",
    category: diff > 0 ? "은행이자" : "기타지출",
    amount: Math.abs(diff),
    description: "총무 잔액 실사 보정",
    createdAt: serverTimestamp()
  });
  alert(`잔액이 ${targetVal.toLocaleString()}원으로 맞춰졌습니다.`);
};

onSnapshot(query(collection(db, "transactions"), orderBy("date", "desc")), (snap) => {
  transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderLedger();
});

function renderLedger() {
  let bal = 0, totalIn = 0, totalOut = 0;
  transactions.forEach(t => {
    const amt = Number(t.amount);
    if (t.type === "in") { bal += amt; totalIn += amt; }
    else { bal -= amt; totalOut += amt; }
  });
  document.getElementById("totalBalance").textContent = bal.toLocaleString() + "원";
  document.getElementById("totalInChip").textContent = totalIn.toLocaleString() + "원";
  document.getElementById("totalOutChip").textContent = totalOut.toLocaleString() + "원";

  const filtered = transactions.filter(t => txFilter === "all" || t.type === txFilter);
  const el = document.getElementById("txList");
  if (!filtered.length) { el.innerHTML = `<div class="empty-msg">내역이 없습니다.</div>`; return; }
  el.innerHTML = filtered.map(t => `
    <div class="list-item">
      <div>
        <div>${t.category ? `<span class="cat-tag">${t.category}</span>` : ""}<span class="bold-text">${t.description}</span></div>
        <div class="muted-text">${t.date}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="${t.type === "in" ? "tx-amount-in" : "tx-amount-out"}">${t.type === "in" ? "+" : "-"}${Number(t.amount).toLocaleString()}원</span>
        ${isAdmin ? `<button class="btn-danger" onclick="deleteTx('${t.id}')">삭제</button>` : ""}
      </div>
    </div>`).join("");
}

document.getElementById("addTxBtn").onclick = async () => {
  const date = document.getElementById("txDate").value, type = document.getElementById("txType").value;
  const category = document.getElementById("txCategory").value, amount = Number(document.getElementById("txAmount").value);
  const description = document.getElementById("txDesc").value.trim() || category;
  if (!date || !amount) return alert("날짜와 금액을 입력하세요.");
  await addDoc(collection(db, "transactions"), { date, type, category, amount, description, createdAt: serverTimestamp() });
  document.getElementById("txAmount").value = ""; document.getElementById("txDesc").value = "";
};
window.deleteTx = async (id) => { if (confirm("이 내역을 삭제할까요?")) await deleteDoc(doc(db, "transactions", id)); };

onSnapshot(query(collection(db, "members"), orderBy("name", "asc")), (snap) => {
  members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  loadDraftForMonth();
  renderExemptUI();
  renderMembers();
  if (isAdmin) renderSecretNotes();
});

function loadDraftForMonth() {
  const mo = monthSelector.value;
  draftPaid = {};
  members.forEach(m => { draftPaid[m.id] = !!(m.paidMonths && m.paidMonths[mo]); });
}

function isPastDue(ym) {
  const [y, m] = ym.split("-").map(Number);
  const dueDate = new Date(y, m - 1, 21, 23, 59, 59);
  return new Date() > dueDate;
}

function renderMembers() {
  const mo = monthSelector.value, targetMembers = members.filter(m => !exemptMembers.includes(m.name));
  const paidCount = targetMembers.filter(m => m.paidMonths && m.paidMonths[mo]).length;
  document.getElementById("monthStatusChip").innerHTML = `${mo} 납부: <span>${paidCount}명</span> / 대상 ${targetMembers.length}명`;

  const container = document.getElementById("memberDuesList");
  if (!members.length) { container.innerHTML = `<div class="empty-msg">등록된 멤버가 없습니다.</div>`; return; }

  if (duesMode === "monthly") {
    const past = isPastDue(mo);
    container.innerHTML = members.map((m, idx) => {
      const isEx = exemptMembers.includes(m.name);
      const checked = !!draftPaid[m.id];
      const savedPaid = !!(m.paidMonths && m.paidMonths[mo]);
      let rightHtml = "";
      if (isEx) rightHtml = `<span class="badge badge-exempt">회장단 면제</span>`;
      else if (isAdmin) rightHtml = `<input type="checkbox" class="one-check" ${checked ? "checked" : ""} onchange="toggleDraft('${m.id}', this.checked)">`;
      else rightHtml = savedPaid ? `<span class="badge badge-paid">납부완료</span>` : (past ? `<span class="badge badge-unpaid">미납</span>` : `<span class="badge badge-exempt">예정</span>`);

      return `
        <div class="list-item">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="muted-text" style="width:20px;">${idx + 1}</span>
            <span class="bold-text">${m.name}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${rightHtml}
            ${isAdmin ? `<button class="btn-danger" onclick="deleteMember('${m.id}', '${m.name}')">삭제</button>` : ""}
          </div>
        </div>`;
    }).join("");
  } else {
    const yr = document.getElementById("yearSelector").value;
    container.innerHTML = members.map((m, idx) => {
      const isEx = exemptMembers.includes(m.name);
      let paidCnt = 0, unpaidCnt = 0;
      const pills = Array.from({ length: 12 }, (_, i) => {
        const ym = `${yr}-${String(i + 1).padStart(2, "0")}`;
        if (isEx) return `<div class="m-pill m-future">${i + 1}월</div>`;
        const ok = !!(m.paidMonths && m.paidMonths[ym]);
        if (ok) { paidCnt++; return `<div class="m-pill m-paid">${i + 1}월</div>`; }
        if (isPastDue(ym)) { unpaidCnt++; return `<div class="m-pill m-unpaid">${i + 1}월</div>`; }
        return `<div class="m-pill m-future">${i + 1}월</div>`;
      }).join("");

      const summary = isEx ? `<span class="badge badge-exempt">면제</span>`
        : `<span class="bold-text" style="color:var(--blue);">${paidCnt}건 납부</span>${unpaidCnt > 0 ? ` · <span style="color:var(--red); font-weight:700;">${unpaidCnt}건 미납</span>` : ""}`;

      return `
        <div class="year-card-row">
          <div class="row-between" style="margin-bottom:0;">
            <span class="bold-text">${idx + 1}. ${m.name}</span>
            <div>${summary}</div>
          </div>
          <div class="month-grid">${pills}</div>
        </div>`;
    }).join("");
  }
}

window.toggleDraft = (id, val) => { draftPaid[id] = val; };
window.localBulkCheck = (val) => {
  members.forEach(m => { if (!exemptMembers.includes(m.name)) draftPaid[m.id] = val; });
  renderMembers();
};

document.getElementById("saveMonthlyDuesBtn").onclick = async () => {
  const mo = monthSelector.value;
  let newlyPaid = 0;
  const batch = writeBatch(db);
  members.forEach(m => {
    if (exemptMembers.includes(m.name)) return;
    const prev = !!(m.paidMonths && m.paidMonths[mo]);
    const next = !!draftPaid[m.id];
    if (!prev && next) newlyPaid++;
    if (prev !== next) batch.update(doc(db, "members", m.id), { [`paidMonths.${mo}`]: next });
  });
  await batch.commit();

  if (newlyPaid > 0) {
    const addAmt = newlyPaid * 20000;
    if (confirm(`납부 현황이 저장되었습니다!\n새로 납부 완료된 ${newlyPaid}명(${addAmt.toLocaleString()}원)을 입출금 장부에도 자동 입금 등록할까요?`)) {
      await addDoc(collection(db, "transactions"), {
        date: new Date().toISOString().slice(0, 10),
        type: "in",
        category: "정기회비",
        amount: addAmt,
        description: `${mo} 정기회비 (${newlyPaid}명)`,
        createdAt: serverTimestamp()
      });
    }
  } else {
    alert("납부 현황이 저장되었습니다.");
  }
};

function renderExemptUI() {
  document.getElementById("exemptChipsArea").innerHTML = exemptMembers.map(name =>
    `<span class="exempt-chip">${name} <button onclick="removeExempt('${name}')">×</button></span>`
  ).join("");
  const nonExempt = members.filter(m => !exemptMembers.includes(m.name));
  document.getElementById("exemptMemberSelect").innerHTML = nonExempt.length
    ? nonExempt.map(m => `<option value="${m.name}">${m.name}</option>`).join("")
    : `<option value="">선택 가능 멤버 없음</option>`;
}

document.getElementById("addExemptBtn").onclick = async () => {
  const name = document.getElementById("exemptMemberSelect").value;
  if (!name || exemptMembers.includes(name)) return;
  await setDoc(doc(db, "config", "settings"), { exemptMembers: [...exemptMembers, name] }, { merge: true });
};

window.removeExempt = async (name) => {
  await setDoc(doc(db, "config", "settings"), { exemptMembers: exemptMembers.filter(n => n !== name) }, { merge: true });
};

document.getElementById("addMemberBtn").onclick = async () => {
  const names = document.getElementById("newMemberNames").value.split(",").map(s => s.trim()).filter(Boolean);
  if (!names.length) return;
  const batch = writeBatch(db);
  names.forEach(name => batch.set(doc(collection(db, "members")), { name, paidMonths: {} }));
  await batch.commit();
  document.getElementById("newMemberNames").value = "";
};

window.deleteMember = async (id, name) => { if (confirm(`'${name}' 멤버를 삭제할까요?`)) await deleteDoc(doc(db, "members", id)); };

let unsubNotes = null, unsubFormer = null;
function subscribeSecretData() {
  if (unsubNotes) unsubNotes();
  unsubNotes = onSnapshot(collection(db, "member_notes"), snap => {
    memberNotes = {}; snap.docs.forEach(d => memberNotes[d.id] = d.data().note || ""); renderSecretNotes();
  });
  if (unsubFormer) unsubFormer();
  unsubFormer = onSnapshot(collection(db, "former_members"), snap => {
    formerMembers = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderFormerMembers();
  });
}

function renderFormerMembers() {
  const el = document.getElementById("formerMembersList");
  el.innerHTML = formerMembers.length ? formerMembers.map(f => `
    <div class="list-item">
      <div><span class="bold-text">${f.name}</span> <span class="badge badge-note">탈회</span><div style="color:var(--sub); margin-top:4px;">${f.note}</div></div>
      <button class="btn-danger" onclick="deleteFormer('${f.id}')">삭제</button>
    </div>`).join("") : `<div class="muted-text">기록된 탈퇴 멤버가 없습니다.</div>`;
}

document.getElementById("addFormerBtn").onclick = async () => {
  const name = document.getElementById("formerName").value.trim(), note = document.getElementById("formerNote").value.trim();
  if (!name || !note) return alert("이름과 내용을 모두 입력하세요.");
  await addDoc(collection(db, "former_members"), { name, note, createdAt: serverTimestamp() });
  document.getElementById("formerName").value = ""; document.getElementById("formerNote").value = "";
};
window.deleteFormer = async (id) => { if (confirm("삭제할까요?")) await deleteDoc(doc(db, "former_members", id)); };

function renderSecretNotes() {
  document.getElementById("secretNotesList").innerHTML = members.map((m, idx) => {
    const val = (memberNotes[m.id] || "").trim();
    const hasMemo = val.length > 0;
    return `
      <div class="note-accordion ${hasMemo ? "has-memo" : ""}" id="acc-${m.id}">
        <div class="note-acc-header" onclick="document.getElementById('acc-${m.id}').classList.toggle('open')">
          <span class="bold-text">${idx + 1}. ${m.name}</span>
          <div>${hasMemo ? `<span class="badge badge-note">특이사항 있음 ▾</span>` : `<span class="muted-text">메모 추가 ▾</span>`}</div>
        </div>
        <div class="note-acc-body">
          <textarea id="note-ta-${m.id}" placeholder="특이사항 전체 내용을 입력하세요...">${val}</textarea>
          <button class="btn-primary full-btn" onclick="saveNote('${m.id}')">메모 저장</button>
        </div>
      </div>`;
  }).join("");
}

window.saveNote = async (id) => {
  const text = document.getElementById("note-ta-" + id).value.trim();
  await setDoc(doc(db, "member_notes", id), { note: text, updatedAt: serverTimestamp() });
  alert("특이사항이 저장되었습니다.");
};

document.getElementById("resetAndSeedBtn").onclick = async () => {
  if (!confirm("2026년 최신 장부(잔액 4,213,862원)와 23명 명단, 특이사항을 복구할까요?")) return;

  try {
    for (const colName of ["transactions", "members", "member_notes", "former_members"]) {
      const snap = await getDocs(collection(db, colName));
      if (!snap.empty) {
        const delBatch = writeBatch(db);
        snap.docs.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
      }
    }

    const batch = writeBatch(db);
    const initTxs = [
      { date: "2026-01-01", type: "in", category: "이월금", amount: 5549119, description: "2025년도 잔여분 이월" },
      { date: "2026-01-11", type: "
