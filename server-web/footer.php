  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="brand-logo" style="margin-bottom: 8px;">
            <img src="/assets/logo.png" alt="FOX PLAYER Logo" style="height: 36px;">
            <span>FOX <b>PLAYER</b></span>
          </a>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 320px;">
            Pure media player application. No streams, channels, or audiovisual content are bundled or sold.
          </p>
        </div>

        <div class="footer-links">
          <a href="/upload">Upload Playlist</a>
          <a href="/activation">Activate Device</a>
          <a href="/terms">Terms of Online Sale</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/contact-us">Contact Us</a>
          <a href="/admin">Admin Portal</a>
        </div>
      </div>

      <div class="footer-bottom">
        <p>&copy; <?php echo date('Y'); ?> FOX PLAYER. All rights reserved. Developed and optimized for multi-platform IPTV streaming.</p>
      </div>
    </div>
  </footer>

  <script>
    // Shared Frontend Client for api.foxplayer.app
    window.API_BASE = 'https://api.foxplayer.app';

    // Toast notifications
    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `<span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    // Mobile menu toggle
    const mobileBtn = document.getElementById('mobile-toggle');
    const navLinks = document.getElementById('nav-links');
    if (mobileBtn && navLinks) {
      mobileBtn.addEventListener('click', () => {
        navLinks.classList.toggle('mobile-open');
      });
    }

    // MAC Address automatic formatting helper
    function formatMacInput(input) {
      input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (val.length > 12) val = val.substring(0, 12);
        let formatted = '';
        for (let i = 0; i < val.length; i++) {
          if (i > 0 && i % 2 === 0) formatted += ':';
          formatted += val[i];
        }
        e.target.value = formatted;
      });
    }
  </script>
</body>
</html>
