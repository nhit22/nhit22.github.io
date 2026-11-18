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

const $ = (id) => document.getElementById(id);
let isAdmin = false, transactions = [], members = [], memberNotes = {}, formerMembers = [];
let exemptMembers = ["김의수", "박소연", "정승희"];
let accountText = "카카오뱅크 3333360366378 정승희";
let duesMode = "monthly", txFilter = "all", draftPaid = {};

const CATEGORIES = {
  in: ["정기회비", "추가회비", "은행이자", "이월금", "기타수입"],
  out: ["결혼", "출산", "조의", "돌잔치", "모임/식비", "기타지출"]
};

const today = new Date();
if ($("txDate")) $("txDate").valueAsDate = today;
const monthSelector = $("monthSelector");
if (monthSelector) {
  monthSelector.value = today.toISOString().slice(0, 7);
  monthSelector.onchange = () => { loadDraftForMonth(); renderMembers(); };
}
if ($("yearSelector")) $("yearSelector").onchange = () => renderMembers();

window.copyAccount = () => {
  navigator.clipboard.writeText(accountText);
  alert(`계좌정보 복사 완료:\n${accountText}`);
};

window.editAccountInfo = async () => {
  const nextAcc = prompt("변경할 모임통장 계좌정보를 입력하세요:", accountText);
  if (!nextAcc || !nextAcc.trim()) return;
  try {
    await setDoc(doc(db, "config", "settings"), { accountText: nextAcc.trim() }, { merge: true });
    alert("계좌정보가 변경되었습니다.");
  } catch (e) {
    alert("권한 오류: " + e.message);
  }
};

window.updateCategoryOptions = () => {
  if (!$("txType") || !$("txCategory")) return;
  const type = $("txType").value;
  $("txCategory").innerHTML = CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join("");
};
updateCategoryOptions();

window.switchTab = (tab, btn) => {
  document.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  if (btn) btn.classList.add("active");
  if ($("tab-" + tab)) $("tab-" + tab).classList.add("active");
};

window.setDuesMode = (mode) => {
  duesMode = mode;
  if ($("viewMonthlyBtn")) $("viewMonthlyBtn").classList.toggle("active", mode === "monthly");
  if ($("viewYearlyBtn")) $("viewYearlyBtn").classList.toggle("active", mode === "yearly");
  if ($("monthlyControls")) $("monthlyControls").style.display = mode === "monthly" ? "flex" : "none";
  if ($("yearlyControls")) $("yearlyControls").style.display = mode === "yearly" ? "flex" : "none";
  if ($("saveDuesBar")) $("saveDuesBar").style.display = (mode === "monthly" && isAdmin) ? "block" : "none";
  renderMembers();
};

window.setTxFilter = (filter, btn) => {
  txFilter = filter;
  document.querySelectorAll("#tab-ledger .sub-seg-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderLedger();
};

if ($("loginBtn")) $("loginBtn").onclick = () => signInWithPopup(auth, provider);
if ($("logoutBtn")) $("logoutBtn").onclick = () => signOut(auth);

onSnapshot(doc(db, "config", "settings"), (snap) => {
  if (snap.exists()) {
    const data = snap.data();
    if (data.exemptMembers) exemptMembers = data.exemptMembers;
    if (data.accountText) accountText = data.accountText;
  }
  if ($("accountDisplay")) $("accountDisplay").textContent = accountText;
  if ($("exemptNamesText")) $("exemptNamesText").textContent = exemptMembers.join(", ") || "없음";
  renderExemptUI();
  renderMembers();
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    if ($("loginBtn")) $("loginBtn").style.display = "none";
    if ($("logoutBtn")) $("logoutBtn").style.display = "inline-block";
    if ($("userInfoCard")) $("userInfoCard").style.display = "block";
    if ($("userEmail")) $("userEmail").textContent = user.email;
    if ($("userUid")) $("userUid").textContent = user.uid;
    const adminSnap = await getDoc(doc(db, "config", "admin"));
    isAdmin = adminSnap.exists() && (adminSnap.data().uids || []).includes(user.uid);
  } else {
    if ($("loginBtn")) $("loginBtn").style.display = "inline-block";
    if ($("logoutBtn")) $("logoutBtn").style.display = "none";
    if ($("userInfoCard")) $("userInfoCard").style.display = "none";
    isAdmin = false;
  }
  if ($("roleBadge")) {
    $("roleBadge").textContent = isAdmin ? "총무 모드" : "일반회원";
    $("roleBadge").className = isAdmin ? "badge badge-paid" : "badge badge-exempt";
  }
  document.querySelectorAll(".admin-only").forEach(el => {
    if (el.id === "saveDuesBar") el.style.display = (isAdmin && duesMode === "monthly") ? "block" : "none";
    else el.style.display = isAdmin ? (el.classList.contains("btn-group") ? "flex" : "block") : "none";
  });
  if (isAdmin) subscribeSecretData();
  renderLedger(); renderMembers();
});

window.editDirectBalance = async () => {
  const current = ($("totalBalance")?.textContent || "0").replace(/[^0-9-]/g, "");
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
  if ($("totalBalance")) $("totalBalance").textContent = bal.toLocaleString() + "원";
  if ($("totalInChip")) $("totalInChip").textContent = totalIn.toLocaleString() + "원";
  if ($("totalOutChip")) $("totalOutChip").textContent = totalOut.toLocaleString() + "원";

  const filtered = transactions.filter(t => txFilter === "all" || t.type === txFilter);
  const el = $("txList");
  if (!el) return;
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

if ($("addTxBtn")) $("addTxBtn").onclick = async () => {
  const date = $("txDate").value, type = $("txType").value;
  const category = $("txCategory")?.value || "", amount = Number($("txAmount").value);
  const description = $("txDesc").value.trim() || category;
  if (!date || !amount) return alert("날짜와 금액을 입력하세요.");
  await addDoc(collection(db, "transactions"), { date, type, category, amount, description, createdAt: serverTimestamp() });
  $("txAmount").value = ""; $("txDesc").value = "";
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
  const mo = monthSelector ? monthSelector.value : today.toISOString().slice(0, 7);
  draftPaid = {};
  members.forEach(m => { draftPaid[m.id] = !!(m.paidMonths && m.paidMonths[mo]); });
}

function isPastDue(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date() > new Date(y, m - 1, 21, 23, 59, 59);
}

function renderMembers() {
  const mo = monthSelector ? monthSelector.value : today.toISOString().slice(0, 7);
  const targetMembers = members.filter(m => !exemptMembers.includes(m.name));
  const paidCount = targetMembers.filter(m => m.paidMonths && m.paidMonths[mo]).length;
  if ($("monthStatusChip")) $("monthStatusChip").innerHTML = `${mo} 납부: <span>${paidCount}명</span> / 대상 ${targetMembers.length}명`;

  const container = $("memberDuesList");
  if (!container) return;
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
    const yr = $("yearSelector")?.value || "2026";
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

if ($("saveMonthlyDuesBtn")) $("saveMonthlyDuesBtn").onclick = async () => {
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
  if ($("exemptChipsArea")) $("exemptChipsArea").innerHTML = exemptMembers.map(name =>
    `<span class="exempt-chip">${name} <button onclick="removeExempt('${name}')">×</button></span>`
  ).join("");
  const nonExempt = members.filter(m => !exemptMembers.includes(m.name));
  if ($("exemptMemberSelect")) $("exemptMemberSelect").innerHTML = nonExempt.length
    ? nonExempt.map(m => `<option value="${m.name}">${m.name}</option>`).join("")
    : `<option value="">선택 가능 멤버 없음</option>`;
}

if ($("addExemptBtn")) $("addExemptBtn").onclick = async () => {
  const name = $("exemptMemberSelect").value;
  if (!name || exemptMembers.includes(name)) return;
  await setDoc(doc(db, "config", "settings"), { exemptMembers: [...exemptMembers, name] }, { merge: true });
};

window.removeExempt = async (name) => {
  await setDoc(doc(db, "config", "settings"), { exemptMembers: exemptMembers.filter(n => n !== name) }, { merge: true });
};

if ($("addMemberBtn")) $("addMemberBtn").onclick = async () => {
  const names = $("newMemberNames").value.split(",").map(s => s.trim()).filter(Boolean);
  if (!names.length) return;
  const batch = writeBatch(db);
  names.forEach(name => batch.set(doc(collection(db, "members")), { name, paidMonths: {} }));
  await batch.commit();
  $("newMemberNames").value = "";
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
  const el = $("formerMembersList");
  if (!el) return;
  el.innerHTML = formerMembers.length ? formerMembers.map(f => `
    <div class="list-item">
      <div><span class="bold-text">${f.name}</span> <span class="badge badge-note">탈회</span><div style="color:var(--sub); margin-top:4px;">${f.note}</div></div>
      <button class="btn-danger" onclick="deleteFormer('${f.id}')">삭제</button>
    </div>`).join("") : `<div class="muted-text">기록된 탈퇴 멤버가 없습니다.</div>`;
}

if ($("addFormerBtn")) $("addFormerBtn").onclick = async () => {
  const name = $("formerName").value.trim(), note = $("formerNote").value.trim();
  if (!name || !note) return alert("이름과 내용을 모두 입력하세요.");
  await addDoc(collection(db, "former_members"), { name, note, createdAt: serverTimestamp() });
  $("formerName").value = ""; $("formerNote").value = "";
};
window.deleteFormer = async (id) => { if (confirm("삭제할까요?")) await deleteDoc(doc(db, "former_members", id)); };

function renderSecretNotes() {
  const el = $("secretNotesList");
  if (!el) return;
  el.innerHTML = members.map((m, idx) => {
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
  const text = $("note-ta-" + id).value.trim();
  await setDoc(doc(db, "member_notes", id), { note: text, updatedAt: serverTimestamp() });
  alert("특이사항이 저장되었습니다.");
};

if ($("resetAndSeedBtn")) $("resetAndSeedBtn").onclick = async () => {
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
      { date: "2026-01-11", type: "out", category: "결혼", amount: 1000000, description: "박세아 결혼 지원금" },
      { date: "2026-01-11", type: "out", category: "결혼", amount: 43000, description: "박세아 결혼 화환" },
      { date: "2026-01-28", type: "out", category: "결혼", amount: 1000000, description: "봉한결 결혼 지원금" },
      { date: "2026-01-28", type: "out", category: "결혼", amount: 44500, description: "봉한결 결혼 화환" },
      { date: "2026-04-19", type: "out", category: "결혼", amount: 2000000, description: "이용희·한수빈 결혼 지원금 (2인)" },
      { date: "2026-04-19", type: "out", category: "결혼", amount: 86000, description: "이용희·한수빈 결혼 화환" },
      { date: "2026-05-18", type: "out", category: "출산", amount: 100000, description: "김유니 출산 선물" },
      { date: "2026-05-23", type: "out", category: "결혼", amount: 1000000, description: "김민재 결혼 지원금" },
      { date: "2026-05-23", type: "out", category: "결혼", amount: 43000, description: "김민재 결혼 화환" },
      { date: "2026-10-31", type: "in", category: "정기회비", amount: 3940000, description: "2026년 1~10월 정기회비 합계 (박소연 반환 제외)" },
      { date: "2026-11-18", type: "in", category: "은행이자", amount: 41243, description: "2026년 세이프박스(41,106원) 및 통장 이자 누적" }
    ];
    initTxs.forEach(t => batch.set(doc(collection(db, "transactions")), { ...t, createdAt: serverTimestamp() }));

    const names = ["김명진","김민재","김유니","김의수","김재연","박세아","박소연","박주성","박지민","봉한결","손일우","신지은","염동환","이동현","이민희","이상규","이용희","이예지","이준명","임우섭","정승희","한수빈","한진"];
    names.forEach(name => {
      const mRef = doc(collection(db, "members"));
      const paidMonths = {};
      if (!["김의수", "박소연", "정승희"].includes(name)) {
        if (name === "김명진") {
          [1,2,3,4,5,6,8,9].forEach(mo => paidMonths[`2026-${String(mo).padStart(2, "0")}`] = true);
        } else {
          const cnt = name === "박주성" ? 9 : 10;
          for (let mo = 1; mo <= cnt; mo++) paidMonths[`2026-${String(mo).padStart(2, "0")}`] = true;
        }
      }
      batch.set(mRef, { name, paidMonths });
      if (name === "염동환") {
        batch.set(doc(db, "member_notes", mRef.id), {
          note: "2025년 12월 추가 회비 200,000원 미납 → 추후 축의금 등 경조사 지원금 지급 시 200,000원 차감 후 지급하기로 합의함.",
          updatedAt: serverTimestamp()
        });
      }
    });

    batch.set(doc(collection(db, "former_members")), {
      name: "이동은",
      note: "2025년 12월 정기회비 납부 완료, 2025년 12월 추가 회비 200,000원 미납 상태에서 2026년 1월 탈회. 추후 재가입 희망 시 탈회 이후 미납된 회비 일체 소급 납부 필요.",
      createdAt: serverTimestamp()
    });

    await batch.commit();
    alert("잔액 4,213,862원과 23명 명단(김명진 7,10월 미납 포함)이 완벽하게 복구되었습니다!");
  } catch (err) {
    alert("오류 발생: " + err.message);
  }
};

if ($("transferAdminBtn")) $("transferAdminBtn").onclick = async () => {
  const nextUid = $("nextAdminUid").value.trim();
  if (!nextUid || !confirm("정말 차기 총무에게 권한을 위임할까요?")) return;
  await setDoc(doc(db, "config", "admin"), { uids: [nextUid] });
  alert("총무 권한이 위임되었습니다."); location.reload();
};
