(function () {
  'use strict';

  /* Escape untrusted strings before they touch innerHTML. Server data
     (make/model) and localStorage values are not trusted here. */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Transient toast — shared by the favorites flows (which run outside the
     DOMContentLoaded scope, so this cannot live inside that callback). */
  function showToast(msg) {
    var t = document.createElement('div');
    t.className = 'toast-notification';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('toast-show'); });
    setTimeout(function () {
      t.classList.remove('toast-show');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  /* ═══════════════════════════════════════════════════════════════
     IMG ERROR FALLBACKS — replaces inline onerror handlers (CSP-safe).
     Error events don't bubble, so listen in the capture phase.
  ═══════════════════════════════════════════════════════════════ */

  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    if (el.hasAttribute('data-onerror-hide')) {
      el.style.display = 'none';
    } else if (el.dataset.onerrorFallback && el.src !== el.dataset.onerrorFallback) {
      el.src = el.dataset.onerrorFallback;
    }
  }, true);


  /* ═══════════════════════════════════════════════════════════════
     SCROLL PROGRESS BAR
  ═══════════════════════════════════════════════════════════════ */

  var progressBar = document.createElement('div');
  progressBar.id = 'scroll-progress';
  document.body.prepend(progressBar);

  window.addEventListener('scroll', function () {
    var scrolled = window.scrollY;
    var total    = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.width = (total > 0 ? (scrolled / total) * 100 : 0) + '%';
  }, { passive: true });


  /* ═══════════════════════════════════════════════════════════════
     PAGE TRANSITIONS
  ═══════════════════════════════════════════════════════════════ */

  // Fade in on load
  document.body.classList.add('page-entering');
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.body.classList.remove('page-entering');
    });
  });

  // When browser restores page from bfcache (back/forward), clear any exit state
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      document.body.classList.remove('page-exit', 'page-entering');
    }
  });

  // Fade out on internal link click
  document.addEventListener('click', function (e) {
    // Another handler (AJAX pagination, modal triggers, etc.) already handled it
    if (e.defaultPrevented) return;
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    // Only intercept internal, non-anchor, non-special links
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('javascript') ||
      link.target === '_blank' ||
      link.hasAttribute('download') ||
      link.dataset.noTransition !== undefined ||
      e.metaKey || e.ctrlKey || e.shiftKey
    ) return;
    if (href.startsWith('http') && !href.includes(location.hostname)) return;

    e.preventDefault();
    document.body.classList.add('page-exit');
    setTimeout(function () { location.href = href; }, 230);
  });


  /* ═══════════════════════════════════════════════════════════════
     CURSOR-INTERACTIVE DOT GRID BACKGROUND
  ═══════════════════════════════════════════════════════════════ */

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  canvas.setAttribute('aria-hidden', 'true'); // purely decorative
  // Insert inside .overlay so it renders above page-specific background overlays
  var overlay = document.querySelector('.overlay');
  if (overlay) {
    overlay.prepend(canvas);
  } else {
    document.body.prepend(canvas);
  }
  var ctx = canvas.getContext('2d');

  var SPACING   = 34;     // grid spacing in px
  var BASE_R    = 1;      // base dot radius
  var MAX_R     = 3;      // radius at cursor
  var REACH     = 200;    // cursor influence radius in px
  var BASE_A    = 0.14;   // base dot alpha
  var MAX_A     = 1.0;    // dot alpha at cursor (full brightness)
  var LERP      = 0.072;  // mouse smoothing (lower = smoother)

  // Accent color — white on homepage, red everywhere else
  var isHome = !!document.querySelector('.home-overlay');
  var AC = isHome ? { r: 255, g: 255, b: 255 } : { r: 237, g: 83, b: 83 };
  var BC = { r: 200, g: 200, b: 210 }; // base dot color (cool white)

  var mouse  = { x: -9999, y: -9999 };
  var cursor = { x: -9999, y: -9999 }; // smoothed
  var dots   = [];
  var raf;

  /* ── Angled sweep wave ─────────────────────────────────────── */
  var WAVE_ANGLE_TAN  = Math.tan(14 * Math.PI / 180); // ~0.249
  var WAVE_HALF_WIDTH = 220;  // px — Gaussian sigma for the wave band
  var WAVE_STRENGTH   = 0.38; // peak boost added to prox
  var WAVE_SPEED      = 0.00038; // progress units per ms
  var WAVE_INTERVAL   = 5500;  // ms between spawns

  var sweepWaves   = [];
  var lastWaveTime = -WAVE_INTERVAL; // spawn first wave quickly

  function spawnWave(now) {
    sweepWaves.push({ startTime: now, progress: 0 });
    lastWaveTime = now;
  }

  /* ── Page-load shockwave (radial) ──────────────────────────── */
  var SHOCK_RADIUS_MAX  = 1800; // px — how far the ring expands
  var SHOCK_HALF_RING   = 80;   // px — Gaussian sigma for ring thickness
  var SHOCK_STRENGTH    = 0.85;
  var SHOCK_DURATION    = 2200; // ms
  var shockwave         = null; // { startTime }


  function buildDots() {
    dots = [];
    var cols = Math.ceil(canvas.width  / SPACING) + 2;
    var rows = Math.ceil(canvas.height / SPACING) + 2;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        dots.push({ x: c * SPACING, y: r * SPACING });
      }
    }
  }

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    buildDots();
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function gaussianFalloff(dist, sigma) {
    return Math.exp(-0.5 * (dist / sigma) * (dist / sigma));
  }

  function draw(now) {
    // Smooth cursor
    cursor.x = lerp(cursor.x, mouse.x, LERP);
    cursor.y = lerp(cursor.y, mouse.y, LERP);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Advance / cull sweep waves ──────────────────────────────
    var w = canvas.width;
    var h = canvas.height;
    // The effective-x range spans from leftmost dot (0 + 0*tan) to rightmost dot (w + h*tan)
    var sweepMin = -(WAVE_HALF_WIDTH * 3);
    var sweepMax = w + h * WAVE_ANGLE_TAN + (WAVE_HALF_WIDTH * 3);

    sweepWaves = sweepWaves.filter(function (wv) {
      wv.progress = (now - wv.startTime) * WAVE_SPEED;
      var frontX = sweepMin + wv.progress * (sweepMax - sweepMin);
      return frontX < sweepMax + WAVE_HALF_WIDTH * 3;
    });

    // Spawn new wave at interval
    if (now - lastWaveTime >= WAVE_INTERVAL) {
      spawnWave(now);
    }

    // ── Shockwave ───────────────────────────────────────────────
    var shockBoostOriginX = 0;
    var shockBoostOriginY = 0;
    var shockActive = false;
    var shockElapsed = 0;
    if (shockwave) {
      shockElapsed = now - shockwave.startTime;
      if (shockElapsed < SHOCK_DURATION) {
        shockActive = true;
        shockBoostOriginX = shockwave.originX;
        shockBoostOriginY = shockwave.originY;
      } else {
        shockwave = null;
      }
    }

    // ── Draw dots ───────────────────────────────────────────────
    for (var i = 0; i < dots.length; i++) {
      var d  = dots[i];
      var dx = d.x - cursor.x;
      var dy = d.y - cursor.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var prox = Math.max(0, 1 - dist / REACH); // 0–1 cursor influence

      // Sweep wave boost
      var waveBoost = 0;
      var dotEffX = d.x + d.y * WAVE_ANGLE_TAN;
      for (var wi = 0; wi < sweepWaves.length; wi++) {
        var wv = sweepWaves[wi];
        var frontX = sweepMin + wv.progress * (sweepMax - sweepMin);
        var waveDist = dotEffX - frontX;
        waveBoost = Math.max(waveBoost, WAVE_STRENGTH * gaussianFalloff(waveDist, WAVE_HALF_WIDTH));
      }

      // Shockwave boost
      var shockBoost = 0;
      if (shockActive) {
        var shockRadius = (shockElapsed / SHOCK_DURATION) * SHOCK_RADIUS_MAX;
        var sdx = d.x - shockBoostOriginX;
        var sdy = d.y - shockBoostOriginY;
        var sDist = Math.sqrt(sdx * sdx + sdy * sdy);
        shockBoost = SHOCK_STRENGTH * gaussianFalloff(sDist - shockRadius, SHOCK_HALF_RING);
      }

      // Combine: cursor prox + wave + shock, clamped to 1
      var combined = Math.min(1, prox + waveBoost * (1 - prox) + shockBoost * (1 - Math.max(prox, waveBoost)));

      var alpha  = BASE_A + combined * (MAX_A  - BASE_A);
      var radius = BASE_R + combined * (MAX_R  - BASE_R);

      // Color: interpolate base cool-white → accent red near cursor/wave
      var r = Math.round(lerp(BC.r, AC.r, combined));
      var g = Math.round(lerp(BC.g, AC.g, combined));
      var b = Math.round(lerp(BC.b, AC.b, combined));

      // Glow: only pay the shadowBlur cost for dots near cursor
      if (combined > 0.05) {
        ctx.shadowBlur  = combined * 14;
        ctx.shadowColor = 'rgba(' + AC.r + ',' + AC.g + ',' + AC.b + ',' + (combined * 0.9) + ')';
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      ctx.fill();
    }

    // Reset shadow so it doesn't bleed
    ctx.shadowBlur = 0;

    // Reduced motion: render one static frame, no continuous loop
    if (!prefersReducedMotion) raf = requestAnimationFrame(draw);
  }

  // Track real mouse position
  document.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    // Also update CSS var for the radial glow overlay
    document.body.style.setProperty('--mx', e.clientX + 'px');
    document.body.style.setProperty('--my', e.clientY + 'px');
  }, { passive: true });

  // When mouse leaves window, fade dots back to base
  document.addEventListener('mouseleave', function () {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  // On touch/mobile: drive dot wave origin from scroll position
  var isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (isTouchDevice) {
    mouse.x = window.innerWidth * 0.5;
    mouse.y = window.innerHeight * 0.4;
    window.addEventListener('scroll', function () {
      var total = document.documentElement.scrollHeight - window.innerHeight;
      var progress = total > 0 ? window.scrollY / total : 0;
      // Gentle sine drift on X, scroll progress on Y
      mouse.x = window.innerWidth  * (0.5 + Math.sin(progress * Math.PI * 3) * 0.25);
      mouse.y = window.innerHeight * (0.15 + progress * 0.7);
    }, { passive: true });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }, { passive: true });

  resize();
  // Respect the OS "reduce motion" preference: draw a single static frame
  // instead of running the continuous RAF loop with waves and shockwaves.
  if (prefersReducedMotion) {
    draw(0);
  } else {
    requestAnimationFrame(function (now) {
      lastWaveTime = now; // start the interval clock from first frame
      draw(now);
    });
  }


  /* ═══════════════════════════════════════════════════════════════
     SCROLL REVEAL
  ═══════════════════════════════════════════════════════════════ */

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.06, rootMargin: '0px 0px -32px 0px' }
  );

  function revealGrid(selector) {
    document.querySelectorAll(selector).forEach(function (row) {
      Array.from(row.children).forEach(function (col, i) {
        if (
          col.classList.contains('col-md-4') ||
          col.classList.contains('col-6')    ||
          col.classList.contains('col-md-3')
        ) {
          col.classList.add('fade-up');
          col.style.setProperty('--delay', i * 0.08 + 's');
          observer.observe(col);
        }
      });
    });
  }

  function revealElements(selector, base) {
    document.querySelectorAll(selector).forEach(function (el, i) {
      el.classList.add('fade-up');
      el.style.setProperty('--delay', (base || 0) + i * 0.1 + 's');
      observer.observe(el);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    revealGrid('.album .row');
    revealGrid('.related-row');
    revealGrid('.garage-grid');
    revealElements('.media-card');
    // NOTE: .detail-section intentionally NOT added to revealElements.
    // Adding fade-up (opacity:0 + transform) to it creates a compositing layer
    // that traps backdrop-filter on child spec-items and the media-card,
    // preventing them from frosting against the ambient background.
    revealElements('.auth-wrap');

    // ── Auto-dismiss flash alerts ────────────────────────────────
    document.querySelectorAll('.alert').forEach(function (alert) {
      setTimeout(function () {
        alert.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        alert.style.opacity = '0';
        alert.style.transform = 'translateY(-8px)';
        setTimeout(function () { alert.remove(); }, 500);
      }, 3000);
    });

    // ── Glass card interactions ──────────────────────────────────
    var MAX_TILT = 2.0; // degrees — very subtle

    function applyGlowTilt(el, e, withTilt) {
      var rect = el.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      el.style.setProperty('--cx',     x + 'px');
      el.style.setProperty('--cy',     y + 'px');
      el.style.setProperty('--cx-pct', (x / rect.width * 100).toFixed(1) + '%');
      if (withTilt) {
        var normX = (x - rect.width  / 2) / (rect.width  / 2); // -1..1
        var normY = (y - rect.height / 2) / (rect.height / 2); // -1..1
        var tiltY = (normX * MAX_TILT).toFixed(2);
        var tiltX = (normY * MAX_TILT).toFixed(2);
        el.style.setProperty('--tilt-x', (-tiltX) + 'deg');
        el.style.setProperty('--tilt-y',   tiltY  + 'deg');
      }
    }

    function resetTilt(el) {
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
    }

    document.querySelectorAll('.card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) { applyGlowTilt(card, e, true); }, { passive: true });
      card.addEventListener('mouseleave', function () { resetTilt(card); }, { passive: true });
    });

    // Make tiles — tilt + glow
    document.querySelectorAll('.make-tile').forEach(function (tile) {
      tile.addEventListener('mousemove', function (e) { applyGlowTilt(tile, e, true); }, { passive: true });
      tile.addEventListener('mouseleave', function () { resetTilt(tile); }, { passive: true });
    });

    // Spec items — glow only (too small to tilt)
    document.querySelectorAll('.spec-item').forEach(function (item) {
      item.addEventListener('mousemove', function (e) { applyGlowTilt(item, e, false); }, { passive: true });
    });

    // Modal content — glow only (cursor follow, no tilt)
    document.querySelectorAll('.modal-content').forEach(function (modal) {
      modal.addEventListener('mousemove', function (e) { applyGlowTilt(modal, e, false); }, { passive: true });
    });

    // ── Nav search ──────────────────────────────────────────────
    var navSearchBtn     = document.getElementById('nav-search-btn');
    var navSearchOverlay = document.getElementById('nav-search-overlay');
    var navSearchInput   = document.getElementById('nav-search-input');
    var navSearchClose   = document.querySelector('.nav-search-close');

    if (navSearchBtn && navSearchOverlay && navSearchInput) {
      function openNavSearch() {
        navSearchOverlay.classList.add('open');
        navSearchOverlay.setAttribute('aria-hidden', 'false');
        navSearchOverlay.removeAttribute('inert');
        navSearchInput.focus();
      }
      function closeNavSearch() {
        if (!navSearchOverlay.classList.contains('open')) return;
        navSearchOverlay.classList.remove('open');
        navSearchOverlay.setAttribute('aria-hidden', 'true');
        navSearchOverlay.setAttribute('inert', '');
        navSearchInput.value = '';
        var dd = navSearchOverlay.querySelector('.suggest-dropdown');
        if (dd) dd.style.display = 'none';
        navSearchBtn.focus(); // return focus to the trigger
      }

      navSearchBtn.addEventListener('click', openNavSearch);
      if (navSearchClose) navSearchClose.addEventListener('click', closeNavSearch);
      navSearchOverlay.setAttribute('inert', '');

      navSearchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var q = navSearchInput.value.trim();
          if (q) window.location.href = '/search?q=' + encodeURIComponent(q);
        }
        if (e.key === 'Escape') closeNavSearch();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeNavSearch();
      });

      navSearchOverlay.addEventListener('click', function (e) {
        if (e.target === navSearchOverlay) closeNavSearch();
      });
    }

    // ── Recently Viewed ──────────────────────────────────────────
    // Detail page publishes the current car via #car-recent-data; the homepage
    // renders the stored list. Both paths avoid inline scripts (CSP-safe).
    var recentDataEl = document.getElementById('car-recent-data');
    if (recentDataEl) {
      try {
        var entry = {
          make: recentDataEl.dataset.make,
          model: recentDataEl.dataset.model,
          image: recentDataEl.dataset.image,
          url: window.location.href
        };
        var key = 'autodex_recent';
        var saved = JSON.parse(localStorage.getItem(key) || '[]');
        saved = saved.filter(function (c) { return !(c.make === entry.make && c.model === entry.model); });
        saved.unshift(entry);
        if (saved.length > 6) saved = saved.slice(0, 6);
        localStorage.setItem(key, JSON.stringify(saved));
      } catch (e) {}
    }

    var rvWrap = document.getElementById('recently-viewed');
    if (rvWrap) {
      try {
        var recent = JSON.parse(localStorage.getItem('autodex_recent') || '[]');
        if (recent.length > 0) {
          var row = rvWrap.querySelector('.recently-viewed-row');
          recent.forEach(function (c) {
            var col = document.createElement('div');
            col.className = 'col-md-2 col-4 mb-3 card-col';
            var safeUrl = escapeHtml(c.url);
            col.innerHTML = '<div class="card h-100">' +
              '<a href="' + safeUrl + '"><img class="card-img-top imgresp" src="' + escapeHtml(c.image) + '" alt="' + escapeHtml(c.model) + '" style="height:90px;"></a>' +
              '<div class="card-body" style="padding:0.5rem;">' +
              '<p class="card-text mb-0" style="font-size:0.72rem;"><a href="' + safeUrl + '" class="text-dark">' + escapeHtml(c.model) + '</a></p>' +
              '</div></div>';
            row.appendChild(col);
          });
          rvWrap.style.display = 'block';
        }
      } catch (e) {}
    }

    // Favorite forms are handled exclusively by initFavForms() below.
    // (A second global interceptor here used to double-submit every POST and,
    // because it matched /fav as a substring, hijack /cars/favorites/... too.)

    // ── Search form loading state ─────────────────────────────────
    var heroForm = document.querySelector('.hero-form');
    if (heroForm) {
      heroForm.addEventListener('submit', function() {
        var btn = heroForm.querySelector('button[type="submit"]');
        if (btn) { btn.textContent = 'Searching…'; btn.disabled = true; }
      });
    }

    // ── Search autocomplete ───────────────────────────────────────────
    document.querySelectorAll('.search-input-wrap').forEach(function(wrap) {
      var input    = wrap.querySelector('input[name="q"]');
      var dropdown = wrap.querySelector('.suggest-dropdown');
      if (!input || !dropdown) return;

      var debounce, reqId = 0;

      function hide() { dropdown.style.display = 'none'; }
      function show() { if (dropdown.innerHTML.trim()) dropdown.style.display = 'block'; }

      input.addEventListener('input', function() {
        clearTimeout(debounce);
        var q = this.value.trim();
        if (q.length < 2) { hide(); return; }
        var id = ++reqId;
        debounce = setTimeout(function() {
          fetch('/suggest?q=' + encodeURIComponent(q))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (id !== reqId) return; // discard stale response
              var html = '';
              if (data.makes.length) {
                html += '<div class="suggest-label">Makes</div>';
                data.makes.forEach(function(m) {
                  html += '<a class="suggest-item" href="/cars?selectmake=' + encodeURIComponent(m) + '">' + escapeHtml(m) + '</a>';
                });
              }
              if (data.models.length) {
                html += '<div class="suggest-label">Models</div>';
                data.models.forEach(function(c) {
                  html += '<a class="suggest-item" href="/cars/car?make=' + encodeURIComponent(c.make) + '&model=' + encodeURIComponent(c.model) + '"><span class="suggest-make">' + escapeHtml(c.make) + '</span>' + escapeHtml(c.model) + '</a>';
                });
              }
              if (!html) { hide(); return; }
              dropdown.innerHTML = html;
              show();
            })
            .catch(hide);
        }, 200);
      });

      // Prevent blur when clicking inside dropdown (fixes "only first item clickable")
      dropdown.addEventListener('mousedown', function(e) { e.preventDefault(); });

      // Close when clicking outside the wrap
      document.addEventListener('click', function(e) {
        if (!wrap.contains(e.target)) hide();
      });

      input.addEventListener('focus', function() {
        if (this.value.trim().length >= 2) show();
      });
    });

  });


  /* ═══════════════════════════════════════════════════════════════
     NAV: opaque on scroll
  ═══════════════════════════════════════════════════════════════ */

  var masthead = document.querySelector('.masthead');
  if (masthead) {
    window.addEventListener('scroll', function () {
      masthead.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }


  /* ═══════════════════════════════════════════════════════════════
     FAVORITES MODAL — image source tabs + update button
  ═══════════════════════════════════════════════════════════════ */

  // Tab switching (ARIA tablist semantics: aria-selected + roving tabindex)
  function activateTab(btn) {
    var modal = btn.closest('.modal-content');
    if (!modal) return;
    modal.querySelectorAll('.img-tab-btn').forEach(function (b) {
      var selected = b === btn;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-selected', String(selected));
      b.tabIndex = selected ? 0 : -1;
    });
    modal.querySelectorAll('.img-tab-pane').forEach(function (p) { p.style.display = 'none'; });
    var pane = document.getElementById(btn.dataset.tab);
    if (pane) pane.style.display = '';
  }

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.img-tab-btn');
    if (btn) activateTab(btn);
  });

  // Left/Right arrows move between tabs in a tablist
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var btn = e.target.closest && e.target.closest('.img-tab-btn');
    if (!btn) return;
    var list = btn.closest('.img-source-tabs');
    var tabs = Array.prototype.slice.call(list.querySelectorAll('.img-tab-btn'));
    var idx = tabs.indexOf(btn);
    var next = e.key === 'ArrowRight'
      ? tabs[(idx + 1) % tabs.length]
      : tabs[(idx - 1 + tabs.length) % tabs.length];
    if (next) { next.focus(); activateTab(next); }
    e.preventDefault();
  });

  // Update Image button — submits the active form (favorites)
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.fav-update-btn');
    if (!btn) return;
    var id = btn.dataset.id;
    var modal = btn.closest('.modal-content');
    var activeTab = modal.querySelector('.img-tab-btn.active');
    var tabId = activeTab ? activeTab.dataset.tab : ('url-' + id);
    var isUpload = tabId.startsWith('upload-');
    var form = document.getElementById((isUpload ? 'upload-form-' : 'url-form-') + id);
    if (form) form.submit();
  });

  // Update Image button on the car detail page's edit-favorite modal
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.detail-fav-save');
    if (!btn) return;
    var modal = btn.closest('.modal-content');
    var activeTab = modal.querySelector('.img-tab-btn.active');
    var isUpload = activeTab && activeTab.dataset.tab === 'detail-fav-upload';
    var form = document.getElementById(isUpload ? 'detail-fav-upload-form' : 'detail-fav-url-form');
    if (form) form.submit();
  });

  // Save Changes button — submits the active form (garage my cars)
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.garage-update-btn');
    if (!btn) return;
    var id = btn.dataset.id;
    var modal = btn.closest('.modal-content');
    var activeTab = modal.querySelector('.img-tab-btn.active');
    var tabId = activeTab ? activeTab.dataset.tab : ('car-url-' + id);
    var isUpload = tabId.startsWith('car-upload-');
    var form = document.getElementById((isUpload ? 'car-upload-form-' : 'car-url-form-') + id);
    if (form) form.submit();
  });


  /* ═══════════════════════════════════════════════════════════════
     MOBILE NAV — hamburger toggle
  ═══════════════════════════════════════════════════════════════ */

  var hamburger   = document.getElementById('nav-hamburger');
  var mobileMenu  = document.getElementById('nav-mobile-menu');

  if (hamburger && mobileMenu) {
    function setMenu(open) {
      mobileMenu.classList.toggle('open', open);
      hamburger.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', String(open));
      mobileMenu.setAttribute('aria-hidden', String(!open));
      // Keep hidden menu items out of the tab order
      if (open) mobileMenu.removeAttribute('inert');
      else mobileMenu.setAttribute('inert', '');
    }

    setMenu(false);
    hamburger.addEventListener('click', function () {
      setMenu(!mobileMenu.classList.contains('open'));
    });

    // Close on any link click inside the menu
    mobileMenu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') setMenu(false);
    });

    // Close on Esc
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileMenu.classList.contains('open')) setMenu(false);
    });
  }


  /* ═══════════════════════════════════════════════════════════════
     LOGIN RETURN URL — auto-append returnTo to all login links
  ═══════════════════════════════════════════════════════════════ */

  var currentPath = window.location.pathname + window.location.search;
  document.querySelectorAll('a[href="/auth/login"], a[href="/auth/login"], a.login-to-fav').forEach(function(link) {
    link.href = '/auth/login?returnTo=' + encodeURIComponent(currentPath);
  });


  /* ═══════════════════════════════════════════════════════════════
     AJAX FAVORITES — submit fav form without page reload
  ═══════════════════════════════════════════════════════════════ */

  function initFavForms(container) {
    (container || document).querySelectorAll('.fav-form').forEach(function(form) {
      if (form.dataset.favBound) return;
      form.dataset.favBound = '1';
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var card = this.closest('.card');
        fetch(this.action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams(new FormData(this))
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.success === false) {
            showToast('Could not add — try again.');
            return;
          }
          var already = data && data.alreadyFavorited;
          var textBtn = card.querySelector('.fav-text-btn');
          var heartBtn = card.querySelector('.fav-heart');
          if (textBtn && !already) {
            var a = document.createElement('a');
            a.href = '/garage';
            a.className = textBtn.className.replace(/\s*fav-text-btn\s*/, ' ').trim();
            a.innerHTML = '&#9829; View Favorites';
            textBtn.parentNode.replaceChild(a, textBtn);
          }
          if (heartBtn && !already) {
            var count = parseInt(heartBtn.textContent.replace(/[^\d]/g, ''), 10) || 0;
            heartBtn.innerHTML = '&#9829; ' + (count + 1);
            heartBtn.disabled = true;
          }
          if (!already) showToast('Added to favorites \u2665');
        })
        .catch(function() { form.submit(); });
      });
    });
  }

  initFavForms();


  /* ═══════════════════════════════════════════════════════════════
     DETAIL PAGE — live favorite / remove without reload
  ═══════════════════════════════════════════════════════════════ */

  var detailFavArea  = document.getElementById('detail-fav-area');
  var detailFavCount = document.getElementById('detail-fav-count');

  function adjustFavCount(delta) {
    if (!detailFavCount) return;
    var n = parseInt(detailFavCount.textContent.replace(/[^\d]/g, '')) || 0;
    detailFavCount.textContent = '\u2665 ' + Math.max(0, n + delta);
  }

  function bindDetailFavForm() {
    var form = detailFavArea && detailFavArea.querySelector('.detail-fav-form');
    if (!form) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var params = new URLSearchParams(new FormData(this));
      fetch(this.action, {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) return;
        detailFavArea.innerHTML =
          '<button type="button" class="btn btn-outline-secondary btn-sm" data-toggle="modal" data-target="#detailEditFavModal">Edit Favorite</button>' +
          '<form class="detail-remove-form d-inline" style="margin:0;" data-fav-id="' + data.favId + '">' +
          '<button type="submit" class="btn btn-outline-danger btn-sm">Remove</button></form>';
        bindDetailRemoveForm();
        if (!data.alreadyFavorited) adjustFavCount(1);
        showToast('Added to favorites \u2665');
      })
      .catch(function() { form.submit(); });
    });
  }

  function bindDetailRemoveForm() {
    var form = detailFavArea && detailFavArea.querySelector('.detail-remove-form');
    if (!form) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var favId = this.dataset.favId;
      fetch('/cars/favorites/delete/' + favId + '?_method=DELETE', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'x-csrf-token': (document.querySelector('meta[name="csrf-token"]') || {}).content || ''
        }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) return;
        var tmpl = document.getElementById('detail-fav-template');
        detailFavArea.innerHTML = tmpl ? tmpl.innerHTML : '';
        bindDetailFavForm();
        adjustFavCount(-1);
        showToast('Removed from favorites');
      })
      .catch(function() { window.location.reload(); });
    });
  }

  bindDetailFavForm();
  bindDetailRemoveForm();


  /* ═══════════════════════════════════════════════════════════════
     AJAX PAGINATION — updates just the grid, no full page reload
  ═══════════════════════════════════════════════════════════════ */

  var carsGrid = document.getElementById('cars-grid');
  if (carsGrid) {
    carsGrid.addEventListener('click', function (e) {
      var link = e.target.closest('a.pg-btn');
      if (!link || link.classList.contains('disabled')) return;
      e.preventDefault();

      var url = link.getAttribute('href');
      var partialUrl = url + (url.indexOf('?') !== -1 ? '&' : '?') + 'partial=1';

      carsGrid.style.opacity = '0.4';
      carsGrid.style.transition = 'opacity 0.15s ease';

      fetch(partialUrl)
        .then(function (r) { return r.text(); })
        .then(function (html) {
          carsGrid.innerHTML = html;
          carsGrid.style.opacity = '1';
          window.history.pushState({}, '', url);
          initFavForms(carsGrid);
          carsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        })
        .catch(function () {
          carsGrid.style.opacity = '1';
          window.location.href = url;
        });
    });
  }


  /* ═══════════════════════════════════════════════════════════════
     PHOTO GALLERY — preview + AJAX voting
  ═══════════════════════════════════════════════════════════════ */

  function setHeroImage(url) {
    var hero = document.querySelector('.car-hero');
    if (hero && url) hero.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
  }

  document.addEventListener('click', function (e) {
    var thumb = e.target.closest && e.target.closest('.gallery-thumb');
    if (!thumb) return;
    setHeroImage(thumb.dataset.full);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains('vote-form')) return;
    e.preventDefault();
    var item = form.closest('.gallery-item');
    fetch(form.action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams(new FormData(form))
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.success) { showToast('Could not record your vote.'); return; }
      item.querySelector('.vote-score').textContent = data.score;
      var up = item.querySelector('.vote-up');
      var down = item.querySelector('.vote-down');
      up.classList.toggle('active', data.myVote === 1);
      down.classList.toggle('active', data.myVote === -1);
      up.setAttribute('aria-pressed', data.myVote === 1);
      down.setAttribute('aria-pressed', data.myVote === -1);
      // Clicking an active arrow again clears the vote
      up.form.querySelector('[name=value]').value = data.myVote === 1 ? 0 : 1;
      down.form.querySelector('[name=value]').value = data.myVote === -1 ? 0 : -1;
      if (data.heroUrl) setHeroImage(data.heroUrl);
    })
    .catch(function () { form.submit(); });
  });


  /* ═══════════════════════════════════════════════════════════════
     COMPARE TRAY — up to 3 cars kept in localStorage
  ═══════════════════════════════════════════════════════════════ */

  var COMPARE_KEY = 'autodex_compare';
  var COMPARE_MAX = 3;

  function readCompare() {
    try { return JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]'); } catch (err) { return []; }
  }
  function writeCompare(list) {
    try { localStorage.setItem(COMPARE_KEY, JSON.stringify(list)); } catch (err) {}
  }
  function compareUrl(list) {
    return '/cars/compare?' + list.map(function (c) {
      return 'c=' + encodeURIComponent(c.make + '|' + c.model);
    }).join('&');
  }

  function renderCompareTray() {
    var tray = document.getElementById('compare-tray');
    var list = readCompare();
    // The compare page is its own tray
    if (list.length === 0 || window.location.pathname === '/cars/compare') {
      if (tray) tray.remove();
      return;
    }
    if (!tray) {
      tray = document.createElement('div');
      tray.id = 'compare-tray';
      tray.className = 'compare-tray';
      tray.setAttribute('role', 'region');
      tray.setAttribute('aria-label', 'Cars to compare');
      document.body.appendChild(tray);
    }
    tray.innerHTML = list.map(function (c, i) {
      return '<span class="compare-chip">' +
        '<img src="' + escapeHtml(c.image) + '" alt="">' +
        '<span>' + escapeHtml(c.model) + '</span>' +
        '<button type="button" class="compare-chip-x" data-index="' + i + '" aria-label="Remove ' + escapeHtml(c.make + ' ' + c.model) + '">&times;</button>' +
        '</span>';
    }).join('') +
      '<a class="btn btn-primary btn-sm" href="' + escapeHtml(compareUrl(list)) + '">Compare (' + list.length + ') &rarr;</a>' +
      '<button type="button" class="compare-clear">Clear</button>';
  }

  document.addEventListener('click', function (e) {
    var add = e.target.closest && e.target.closest('.compare-add-btn');
    if (add) {
      var list = readCompare();
      var entry = { make: add.dataset.make, model: add.dataset.model, image: add.dataset.image };
      if (list.some(function (c) { return c.make === entry.make && c.model === entry.model; })) {
        showToast('Already in your compare list');
      } else if (list.length >= COMPARE_MAX) {
        showToast('Compare holds ' + COMPARE_MAX + ' cars. Remove one first.');
      } else {
        list.push(entry);
        writeCompare(list);
        renderCompareTray();
        showToast('Added to compare');
      }
      return;
    }
    var x = e.target.closest && e.target.closest('.compare-chip-x');
    if (x) {
      var l = readCompare();
      l.splice(parseInt(x.dataset.index, 10), 1);
      writeCompare(l);
      renderCompareTray();
      return;
    }
    if (e.target.closest && e.target.closest('.compare-clear')) {
      writeCompare([]);
      renderCompareTray();
      return;
    }
    // Compare page: drop a column by rebuilding the URL without it
    var rm = e.target.closest && e.target.closest('.compare-remove-btn');
    if (rm) {
      var make = rm.dataset.make, model = rm.dataset.model;
      writeCompare(readCompare().filter(function (c) { return !(c.make === make && c.model === model); }));
      var params = new URLSearchParams(window.location.search);
      var keep = params.getAll('c').filter(function (v) { return v !== make + '|' + model; });
      window.location.href = '/cars/compare' + (keep.length ? '?' + keep.map(function (v) { return 'c=' + encodeURIComponent(v); }).join('&') : '');
    }
  });

  renderCompareTray();


  /* ═══════════════════════════════════════════════════════════════
     GARAGE — recall badges (lazy, one NHTSA lookup per car)
  ═══════════════════════════════════════════════════════════════ */

  document.querySelectorAll('.recall-badge[data-recalls-url]').forEach(function (badge) {
    fetch(badge.dataset.recallsUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.count) return;
        badge.textContent = '⚠ ' + data.count + ' recall' + (data.count === 1 ? '' : 's');
        badge.hidden = false;
      })
      .catch(function () {});
  });


  /* ═══════════════════════════════════════════════════════════════
     AUTO-SUBMIT SELECTS (browse page year filter)
  ═══════════════════════════════════════════════════════════════ */

  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('auto-submit') && e.target.form) {
      e.target.form.submit();
    }
  });


  /* ═══════════════════════════════════════════════════════════════
     HERO WORD REVEAL
  ═══════════════════════════════════════════════════════════════ */

  var heading = document.querySelector('.cover-heading');
  if (heading) {
    var words = heading.innerHTML.split(/(\s+|<br\s*\/?>)/gi);
    heading.innerHTML = words.map(function (w, i) {
      if (!w.trim() || /^<br/i.test(w)) return w;
      return '<span class="word-wrap"><span class="word" style="--wi:' + i + '">' + w + '</span></span>';
    }).join('');
  }

})();
