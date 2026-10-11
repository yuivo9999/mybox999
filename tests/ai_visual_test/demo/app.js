(() => {
  const nav = document.querySelector('[data-testid="nav-bar"]');
  const navToggle = document.querySelector('[data-testid="nav-toggle"]');
  navToggle.addEventListener('click', () => {
    const hidden = nav.classList.toggle('is-hidden');
    navToggle.textContent = hidden ? '显示导航' : '隐藏导航';
    navToggle.setAttribute('aria-label', hidden ? '显示导航栏' : '隐藏导航栏');
  });
  const connectDialog = (openSelector, closeSelector) => {
    const dialog = document.querySelector(openSelector);
    document.querySelector(closeSelector).addEventListener('click', () => dialog.close());
    return dialog;
  };
  const channelDialog = connectDialog('[data-testid="channel-dialog"]', '[data-testid="close-channel-dialog"]');
  const ratioDialog = connectDialog('[data-testid="ratio-dialog"]', '[data-testid="close-ratio-dialog"]');
  document.querySelector('[data-testid="channel-button"]').addEventListener('click', () => channelDialog.showModal());
  document.querySelector('[data-testid="ratio-button"]').addEventListener('click', () => ratioDialog.showModal());
})();
