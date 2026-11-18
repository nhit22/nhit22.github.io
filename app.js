import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.copyAccount = () => {
  navigator.clipboard.writeText("3333360366378");
  alert("계좌번호가 복사되었습니다.\n카카오뱅크 3333360366378 정승희");
};

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

const today = new Date();
document.getElementById("txDate").valueAsDate = today;
const monthSelector = document.getElementById("monthSelector");
monthSelector.value = today.toISOString().slice(0, 7);
monthSelector.onchange = () => renderMembers();

window.switchTab = (tabName, btnEl) => {
  document.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(c => c.classList.remove("active"));
  btnEl.classList.add("active");
  document.getElementById("tab-" + tabName).classList.add("active");
};

document.getElementById("loginBtn").onclick = () => signInWithPopup(auth, provider);
document.getElementById("logoutBtn").onclick = () => signOut(auth);

onSnapshot(doc(db, "config", "settings"), (snap) => {
  if (snap.exists() && snap.data().exemptMembers) exemptMembers = snap.data().exemptMembers;
  document.getElementById("exemptNamesText").textContent = exemptMembers.join(", ");
  document.getElementById("exemptInput").value = exemptMembers.join(", ");
  renderMembers();
});

onAuthStateChanged(auth, async (user) => {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userInfoCard = document.getElementById("userInfoCard");
  const roleBadge = document.getElementById("roleBadge");

  if (user) {
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    userInfoCard.style.display = "block";
    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("userUid").textContent = user.uid;
    const adminSnap = await getDoc(doc(db, "config", "admin"));
    const adminUids = adminSnap.exists() ? (adminSnap.data().uids || []) : [];
    isAdmin = adminUids.includes(user.uid);
  } else {
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    userInfoCard.style.display = "none";
    isAdmin = false;
  }

  roleBadge.textContent = isAdmin ? "총무 모드" : "일반회원";
  roleBadge.className = isAdmin ? "badge badge-paid" : "badge badge-exempt";
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = isAdmin ? (el.tagName === "DIV" && el.style.gap ? "flex" : "block") : "none";
  });

  if (isAdmin) subscribeSecretData();
  renderLedger();
  renderMembers();
});

onSnapshot(query(collection(db, "transactions"), orderBy("date", "desc")), (snap) => {
  transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderLedger();
});

function renderLedger() {
  const container = document.getElementById("txList");
  let balance = 0;
  transactions.forEach(tx => balance += (tx.type === "in" ? Number(tx.amount) : -Number(tx.amount)));
  document.getElementById("totalBalance").textContent = balance.toLocaleString() + "원";

  if (transactions.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--muted); padding:20px 0;">거래 내역이 없습니다.</div>`;
    return;
  }
  container.innerHTML = transactions.map(tx => `
    <div class="list-item">
      <div><span class="tx-title">${tx.description}</span><span class="tx-date">${tx.date}</span></div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="${tx.type === 'in' ? 'tx-amount-in' : 'tx-amount-out'}">${tx.type === 'in' ? '+' : '-'}${Number(tx.amount).toLocaleString()}원</span>
        ${isAdmin ? `<button class="btn-danger" onclick="deleteTx('${tx.id}')">삭제</button>` : ''}
      </div>
    </div>`).join("");
}

document.getElementById("addTxBtn").onclick = async () => {
  const date = document.getElementById("txDate").value, type = document.getElementById("txType").value;
  const amount = Number(document.getElementById("txAmount").value), description = document.getElementById("txDesc").value.trim();
  if (!date || !amount || !description) return alert("모두 입력하세요.");
  await addDoc(collection(db, "transactions"), { date, type, amount, description, createdAt: serverTimestamp() });
  document.getElementById("txAmount").value = ""; document.getElementById("txDesc").value = "";
};

window.deleteTx = async (id) => { if (confirm("삭제할까요?")) await deleteDoc(doc(db, "transactions", id)); };

onSnapshot(query(collection(db, "members"), orderBy("name", "asc")), (snap) => {
  members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  document.getElementById("seedSection").style.display = members.length > 0 ? "none" : "block";
  renderMembers();
  if (isAdmin) renderSecretNotes();
});

function renderMembers() {
  const selectedMonth = monthSelector.value, container = document.getElementById("memberDuesList");
  const targetMembers = members.filter(m => !exemptMembers.includes(m.name));
  const paidCount = targetMembers.filter(m => m.paidMonths && m.paidMonths[selectedMonth]).length;
  document.getElementById("monthStatusChip").innerHTML = `${selectedMonth} 납부: <span>${paidCount}명</span> / 대상 ${targetMembers.length}명`;

  if (members.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--muted); padding:20px 0;">등록된 멤버가 없습니다.</div>`;
    return;
  }

  container.innerHTML = members.map((m, idx) => {
    const isExempt = exemptMembers.includes(m.name);
    const isPaid = !!(m.paidMonths && m.paidMonths[selectedMonth]);
    let unpaid2026 = 0;
    if (!isExempt) {
      for (let mo = 1; mo <= 10; mo++) {
        if (!(m.paidMonths && m.paidMonths[`2026-${String(mo).padStart(2, '0')}`])) unpaid2026++;
      }
    }
    const statusHtml = isExempt ? `<span class="badge badge-exempt">회장단 면제</span>`
      : isAdmin ? `<input type="checkbox" class="one-check" ${isPaid ? "checked" : ""} onchange="togglePay('${m.id}', this.checked)">`
      : (isPaid ? `<span class="badge badge-paid">납부완료</span>` : `<span class="badge badge-unpaid">미납</span>`);

    return `
      <div class="list-item">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="color:var(--muted); font-size:0.82rem; width:20px;">${idx + 1}</span>
          <div>
            <div style="font-weight:700;">${m.name}</div>
            ${unpaid2026 > 0 ? `<div style="font-size:0.75rem; color:var(--red); font-weight:600;">2026년 누적 ${unpaid2026}건(${(unpaid2026*20000).toLocaleString()}원) 미납</div>` : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${statusHtml}
          ${isAdmin ? `<button class="btn-danger" onclick="deleteMember('${m.id}', '${m.name}')">삭제</button>` : ''}
        </div>
      </div>`;
  }).join("");
}

window.togglePay = async (id, checked) => updateDoc(doc(db, "members", id), { [`paidMonths.${monthSelector.value}`]: checked });
window.bulkCheck = async (status) => {
  if (!confirm(status ? "전체 일괄 체크할까요?" : "전체 해제할까요?")) return;
  const batch = writeBatch(db);
  members.forEach(m => { if (!exemptMembers.includes(m.name)) batch.update(doc(db, "members", m.id), { [`paidMonths.${monthSelector.value}`]: status }); });
  await batch.commit();
};

document.getElementById("saveExemptBtn").onclick = async () => {
  const list = document.getElementById("exemptInput").value.split(",").map(s => s.trim()).filter(Boolean);
  await setDoc(doc(db, "config", "settings"), { exemptMembers: list }, { merge: true });
  alert("저장되었습니다.");
};

document.getElementById("addMemberBtn").onclick = async () => {
  const names = document.getElementById("newMemberNames").value.split(",").map(s => s.trim()).filter(Boolean);
  if (!names.length) return;
  const batch = writeBatch(db);
  names.forEach(name => batch.set(doc(collection(db, "members")), { name, paidMonths: {} }));
  await batch.commit();
  document.getElementById("newMemberNames").value = "";
};

window.deleteMember = async (id, name) => { if (confirm(`'${name}' 삭제할까요?`)) await deleteDoc(doc(db, "members", id)); };

let unsubNotes = null, unsubFormer = null;
function subscribeSecretData() {
  if (unsubNotes) unsubNotes();
  unsubNotes = onSnapshot(collection(db, "member_notes"), (snap) => {
    memberNotes = {}; snap.docs.forEach(d => memberNotes[d.id] = d.data().note || ""); renderSecretNotes();
  });
  if (unsubFormer) unsubFormer();
  unsubFormer = onSnapshot(collection(db, "former_members"), (snap) => {
    formerMembers = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderFormerMembers();
  });
}

function renderFormerMembers() {
  const el = document.getElementById("formerMembersList");
  el.innerHTML = formerMembers.length ? formerMembers.map(f => `
    <div class="list-item">
      <div><div style="font-weight:700;">${f.name} <span class="warn-tag">탈회</span></div><div style="font-size:0.82rem; color:var(--sub);">${f.note}</div></div>
      <button class="btn-danger" onclick="deleteFormer('${f.id}')">삭제</button>
    </div>`).join("") : `<div style="font-size:0.84rem; color:var(--muted);">없음</div>`;
}

document.getElementById("addFormerBtn").onclick = async () => {
  const name = document.getElementById("formerName").value.trim(), note = document.getElementById("formerNote").value.trim();
  if (!name || !note) return alert("모두 입력하세요.");
  await addDoc(collection(db, "former_members"), { name, note, createdAt: serverTimestamp() });
  document.getElementById("formerName").value = ""; document.getElementById("formerNote").value = "";
};
window.deleteFormer = async (id) => { if (confirm("삭제할까요?")) await deleteDoc(doc(db, "former_members", id)); };

function renderSecretNotes() {
  document.getElementById("secretNotesList").innerHTML = members.map((m, idx) => {
    const val = memberNotes[m.id] || "";
    return `
      <div class="note-block">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="font-weight:700;">${idx + 1}. ${m.name}</span>
          ${(val.includes("차감") || val.includes("미납")) ? `<span class="warn-tag">정산 주의</span>` : ''}
        </div>
        <div class="form-row" style="margin-bottom:0;">
          <input type="text" id="note-input-${m.id}" value="${val.replace(/"/g, '&quot;')}" placeholder="특이사항 입력">
          <button class="btn-soft" onclick="saveNote('${m.id}')">저장</button>
        </div>
      </div>`;
  }).join("");
}

window.saveNote = async (id) => {
  await setDoc(doc(db, "member_notes", id), { note: document.getElementById("note-input-" + id).value.trim(), updatedAt: serverTimestamp() });
  alert("저장되었습니다.");
};

document.getElementById("seedAllBtn").onclick = async () => {
  if (!confirm("초기 데이터를 일괄 세팅할까요?")) return;
  const batch = writeBatch(db);
  batch.set(doc(db, "config", "settings"), { exemptMembers: ["김의수", "박소연", "정승희"] });

  const initTxs = [
    { date: "2026-01-01", type: "in", amount: 5549119, description: "2025년도 잔여분 이월" },
    { date: "2026-01-11", type: "out", amount: 1000000, description: "박세아 결혼 지원금" },
    { date: "2026-01-11", type: "out", amount: 43000, description: "박세아 결혼 화환" },
    { date: "2026-01-28", type: "out", amount: 1000000, description: "봉한결 결혼 지원금" },
    { date: "2026-01-28", type: "out", amount: 44500, description: "봉한결 결혼 화환" },
    { date: "2026-04-19", type: "out", amount: 2000000, description: "이용희·한수빈 결혼 지원금 (2인)" },
    { date: "2026-04-19", type: "out", amount: 86000, description: "이용희·한수빈 결혼 화환" },
    { date: "2026-05-18", type: "out", amount: 100000, description: "김유니 출산 선물" },
    { date: "2026-05-23", type: "out", amount: 1000000, description: "김민재 결혼 지원금" },
    { date: "2026-05-23", type: "out", amount: 43000, description: "김민재 결혼 화환" },
    { date: "2026-10-31", type: "in", amount: 3940000, description: "2026년 1~10월 정기회비 합계 (박소연 반환 제외)" }
  ];
  initTxs.forEach(tx => batch.set(doc(collection(db, "transactions")), { ...tx, createdAt: serverTimestamp() }));

  const names = ["김명진","김민재","김유니","김의수","김재연","박세아","박소연","박주성","박지민","봉한결","손일우","신지은","염동환","이동현","이민희","이상규","이용희","이예지","이준명","임우섭","정승희","한수빈","한진"];
  const notes = {
    "염동환": "2025년 12월 추가 회비 200,000원 미납 → 추후 축의금/경조사 지원금 지급 시 20만원 차감 후 지급",
    "박세아": "2026.01.11 결혼 지원금 100만원 + 화환 지급 완료",
    "봉한결": "2026.01.28 결혼 지원금 100만원 + 화환 지급 완료",
    "이용희": "2026.04.19 결혼 지원금 100만원 + 화환 지급 완료 (한수빈 동기 부부)",
    "한수빈": "2026.04.19 결혼 지원금 100만원 + 화환 지급 완료 (이용희 동기 부부)",
    "김유니": "2026.05.18 출산 선물 10만원 지급 완료",
    "김민재": "2026.05.23 결혼 지원금 100만원 + 화환 지급 완료",
    "김의수": "2026년 회장단 회비 면제 대상",
    "박소연": "2026년 회장단 회비 면제 대상 (실수 입금 2만원 반환 완료)",
    "정승희": "2026년 회장단(총무) 회비 면제 대상"
  };

  names.forEach(name => {
    const mRef = doc(collection(db, "members"));
    const paidMonths = {};
    if (!["김의수", "박소연", "정승희"].includes(name)) {
      const cnt = name === "김명진" ? 8 : (name === "박주성" ? 9 : 10);
      for (let mo = 1; mo <= cnt; mo++) paidMonths[`2026-${String(mo).padStart(2, '0')}`] = true;
    }
    batch.set(mRef, { name, paidMonths });
    if (notes[name]) batch.set(doc(db, "member_notes", mRef.id), { note: notes[name], updatedAt: serverTimestamp() });
  });

  batch.set(doc(collection(db, "former_members")), {
    name: "이동은",
    note: "2025년 12월 정기회비 납부, 12월 추가회비 20만원 미납 후 2026년 1월 탈회. 재가입 희망 시 탈회 이후 미납 회비 전액 소급 납부 필요.",
    createdAt: serverTimestamp()
  });

  await batch.commit();
  alert("초기 데이터 세팅 완료!");
};

document.getElementById("transferAdminBtn").onclick = async () => {
  const nextUid = document.getElementById("nextAdminUid").value.trim();
  if (!nextUid || !confirm("정말 총무 권한을 넘기시겠습니까?")) return;
  await setDoc(doc(db, "config", "admin"), { uids: [nextUid] });
  alert("권한 위임 완료"); location.reload();
};
