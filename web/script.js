const promptEl = document.getElementById('prompt');
const agentEl = document.getElementById('agent');
const runBtn = document.getElementById('run-btn');
const outputEl = document.getElementById('output');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const themeToggle = document.getElementById('theme-toggle');

// Theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.dataset.theme = savedTheme;

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
});

// Run task
runBtn.addEventListener('click', async () => {
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  runBtn.disabled = true;
  outputEl.textContent = '';
  outputEl.className = '';
  statsEl.textContent = '';
  statusEl.textContent = 'Submitting...';
  statusEl.className = '';

  try {
    const agent = agentEl.value === 'auto' ? undefined : agentEl.value;

    const response = await fetch('/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, agent })
    });

    if (!response.ok) throw new Error('Failed to submit task');

    const { id } = await response.json();
    statusEl.textContent = 'Processing...';

    const eventSource = new EventSource(`/task/${id}/stream`);

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      statusEl.textContent = data.status;
    });

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      outputEl.textContent = data.result;
      statusEl.textContent = 'Complete';
      statusEl.className = 'success';
      statsEl.textContent = `Model: ${data.model}`;
      eventSource.close();
      runBtn.disabled = false;
    });

    eventSource.addEventListener('error', (e) => {
      if (e.data) {
        const data = JSON.parse(e.data);
        outputEl.textContent = data.error;
        outputEl.className = 'error';
      }
      statusEl.textContent = 'Failed';
      statusEl.className = 'error';
      eventSource.close();
      runBtn.disabled = false;
    });

    eventSource.onerror = () => {
      statusEl.textContent = 'Connection lost';
      statusEl.className = 'error';
      eventSource.close();
      runBtn.disabled = false;
    };

  } catch (err) {
    outputEl.textContent = err.message;
    outputEl.className = 'error';
    statusEl.textContent = 'Failed';
    statusEl.className = 'error';
    runBtn.disabled = false;
  }
});

// Ctrl+Enter to run
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    runBtn.click();
  }
});
