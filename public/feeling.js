function submitEmotion() {
  const input = document.getElementById('emotionInput');
  const mood = document.getElementById('moodSelect').value;
  const text = input.value.trim();
  const time = new Date().toLocaleString();

  if (text === '') {
    alert('Please write something before submitting.');
    return;
  }

  const newEntry = {
    id: Date.now().toString(),
    text: text || '',   // undefined fix
    mood: mood || '🙂', // undefined fix
    time: time,
    likes: 0
  };

  const entries = JSON.parse(localStorage.getItem('entries') || '[]');
  entries.unshift(newEntry);
  localStorage.setItem('entries', JSON.stringify(entries));

  input.value = '';
  updateCharCount();
  renderEntries();
}

function renderEntries() {
  const entries = JSON.parse(localStorage.getItem('entries') || '[]');
  const container = document.getElementById('entriesContainer');
  container.innerHTML = '';

  entries.forEach(entry => {
    if (!entry.text || !entry.mood) return; // skip broken data
    const div = document.createElement('div');
    div.className = 'entry';
    div.innerHTML = `
      <strong>${entry.mood}</strong> ${entry.text}
      <br><small>${entry.time}</small>
      <br>
      <button onclick="likeEntry('${entry.id}')">❤️ ${entry.likes}</button>
    `;
    container.appendChild(div);
  });
}

function likeEntry(id) {
  const entries = JSON.parse(localStorage.getItem('entries') || '[]');
  const updated = entries.map(entry => {
    if (entry.id === id) entry.likes += 1;
    return entry;
  });
  localStorage.setItem('entries', JSON.stringify(updated));
  renderEntries();
}

function clearAllEntries() {
  if (confirm("Are you sure you want to clear all entries?")) {
    localStorage.removeItem('entries');
    renderEntries();
  }
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
}

function updateCharCount() {
  const len = document.getElementById('emotionInput').value.length;
  document.getElementById('charCount').textContent = `${len}/1000`;
}

document.addEventListener('DOMContentLoaded', () => {
  renderEntries();
  updateCharCount();
  document.getElementById('emotionInput').addEventListener('input', updateCharCount);
});
function submitEmotion() {
  const input = document.getElementById('emotionInput');
  const mood = document.getElementById('moodSelect').value;
  const text = input.value.trim();
  const time = new Date().toLocaleString();

  if (text === '') {
    alert('Please write something before submitting.');
    return;
  }

  const newEntry = {
    id: Date.now().toString(),
    text,
    mood,
    time,
    likes: 0
  };

  const entries = JSON.parse(localStorage.getItem('entries') || '[]');
  entries.unshift(newEntry);
  localStorage.setItem('entries', JSON.stringify(entries));

  // WhatsApp notification
  fetch('http://localhost:5000/send-whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newEntry)
  }).catch(err => console.error("WhatsApp Error:", err));

  input.value = '';
  updateCharCount();
  renderEntries();
}

fetch('https://backendtest-github-io.onrender.com/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(newEntry)
})
