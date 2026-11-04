(() => {
  const form = document.getElementById('private-message-form');
  const statusEl = document.getElementById('msg-status');
  const submitBtn = document.getElementById('msg-submit');
  if (!form || !statusEl || !submitBtn) return;

  const serverUrl = form.dataset.serverUrl;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!serverUrl) {
      statusEl.className = 'form-status error';
      statusEl.textContent = '留言服务尚未配置，请直接通过上方邮箱联系博主。';
      return;
    }

    const nick = document.getElementById('msg-nick')?.value.trim();
    const mail = document.getElementById('msg-mail')?.value.trim();
    const comment = document.getElementById('msg-content')?.value.trim();

    if (!nick || !mail || !comment) {
      statusEl.className = 'form-status error';
      statusEl.textContent = '请完整填写称呼、邮箱与留言内容。';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '正在发送…';
    statusEl.className = 'form-status info';
    statusEl.textContent = '正在发送至博主后台…';

    try {
      const response = await fetch(`${serverUrl}/api/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nick,
          mail,
          comment,
          url: '/about/guestbook',
        }),
      });

      const res = await response.json();
      if (response.ok && (res.errno === 0 || res.data?.id || res.id)) {
        form.reset();
        statusEl.className = 'form-status success';
        statusEl.textContent = '✓ 留言已私密送达博主后台！内容不会公开展示，感谢您的来信。';
      } else if (res.errmsg === 'Comment too fast!') {
        statusEl.className = 'form-status error';
        statusEl.textContent = '发送太频繁啦，请稍候再试。';
      } else {
        statusEl.className = 'form-status error';
        statusEl.textContent = res.errmsg ? `发送失败：${res.errmsg}` : '发送失败，请稍后重试。';
      }
    } catch {
      statusEl.className = 'form-status error';
      statusEl.textContent = '网络连接异常，发送失败，请稍后重试。';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '发送私密留言';
    }
  });
})();
