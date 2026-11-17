/* =========================================================
   رشف · RASHF — منطق الموقع العام
   - اللغات (ar/en) بدون إعادة تحميل + حفظ الاختيار
   - أنيميشن الهيرو (مرة وحدة بكل تحميل، وما بتتعاد لما يرجع الزبون فوق)
   - المنتجات من Supabase (أو الملف التجريبي لما تكون المفاتيح فاضية)
   - البطاقات صور، والأكثر طلباً بطاقة عادية بمكانها عليها شارة
   - النافذة: الصورة تطلع بنعومة، والكبيرة تاخذ مكانها لما تجهز
   - نافذة المنتج: X / ضغطة برا / Esc / زر الرجوع بالجوال
   - زر الإنستجرام: لفّة 360° ثم يفتح الحساب
   ========================================================= */
(function () {
  'use strict';

  var cfg = window.RASHF_CONFIG || {};
  var root = document.documentElement;
  var STORE_KEY = 'rashf-lang';
  var SAMPLE_URL = 'data/products.sample.js';
  var reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // القاموسين ينحمّلون كـ <script> (i18n/ar.js و en.js) قبل هالملف، فيشتغلون حتى لو انفتح الموقع من file://
  var dicts = window.RASHF_I18N || {};
  var lang = root.lang === 'en' ? 'en' : 'ar';
  var products = [];
  var isDemo = false;

  var $ = function (id) { return document.getElementById(id); };
  var hero = document.querySelector('.hero');
  var grid = $('grid');
  var dialog = $('product-dialog');
  var current = null;      // المنتج المفتوح بالنافذة
  var lastTrigger = null;  // الزر اللي فتح النافذة (يرجعله التركيز)

  /* ---------------- الترجمة ---------------- */

  function t(key, vars) {
    var s = (dicts[lang] && dicts[lang][key]) || (dicts.ar && dicts.ar[key]) || '';
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  function applyLang(l) {
    lang = l;
    root.lang = l;
    root.dir = l === 'ar' ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var v = t(el.getAttribute('data-i18n-aria'));
      if (v) el.setAttribute('aria-label', v);
    });

    if (t('meta.title')) document.title = t('meta.title');
    var desc = document.querySelector('meta[name="description"]');
    if (desc && t('meta.description')) desc.setAttribute('content', t('meta.description'));

    if (products.length) renderProducts(false);
    if (current && dialog.open) fillDialog(current);
    root.classList.add('i18n-ready');
  }

  function setLang(l) {
    try { localStorage.setItem(STORE_KEY, l); } catch (e) { /* وضع خاص أو تخزين مقفل */ }
    applyLang(l);
  }

  /* ---------------- مظهر الموقع (يختاره الأدمن) ----------------
     الداكن افتراضي. الأدمن يغيّره من اللوحة، والقيمة بجدول site_settings.
     آخر قيمة تنحفظ بالمتصفح حتى سكربت <head> يطبّقها قبل الرسم بالزيارة الجاية (بدون وميض). */

  var THEME_KEY = 'rashf-site-theme';
  var THEME_COLORS = { light: '#f5eee3', dark: '#15100d' };

  function applyTheme(th) {
    th = th === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', th);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[th]);
    try { localStorage.setItem(THEME_KEY, th); } catch (e) { /* وضع خاص أو تخزين مقفل */ }
  }

  function initTheme() {
    applyTheme(root.getAttribute('data-theme'));
    if (!hasSupabase()) return;  // بدون ربط: يبقى الداكن، أو اللي اختارته معاينة اللوحة بنفس المتصفح
    var url = cfg.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/site_settings?select=theme&id=eq.1';
    fetchJson(url, { headers: { apikey: cfg.SUPABASE_ANON_KEY, Accept: 'application/json' } })
      .then(function (rows) { if (rows && rows[0]) applyTheme(rows[0].theme); })
      .catch(function () { /* يبقى آخر مظهر معروف */ });
  }

  /* ---------------- الهيرو ---------------- */

  var finishTimer = 0;

  function finishWriting() {
    clearTimeout(finishTimer);
    if (!hero.classList.contains('is-writing')) return;
    hero.classList.remove('is-writing');
    hero.classList.add('is-done');
  }

  function initHero() {
    if (!hero) return;
    if (!root.classList.contains('ink-ready')) { hero.classList.add('is-done'); return; }

    hero.classList.add('is-writing');
    finishTimer = setTimeout(finishWriting, 3800);

    // لو نزل الزبون قبل ما تخلص: نكمّلها فوراً حتى لما يرجع يلاقيها كاملة وما تتعاد
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) finishWriting();
      }, { threshold: 0.12 }).observe(hero);
    }
  }

  /* ---------------- المنتجات ---------------- */

  function hasSupabase() {
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  function storageUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    if (isDemo) return path;
    var base = cfg.SUPABASE_URL.replace(/\/+$/, '');
    var bucket = cfg.STORAGE_BUCKET || 'product-images';
    return base + '/storage/v1/object/public/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/');
  }

  // الصورة الصغيرة (960×1200) للشبكة. لوحة الأدمن بترفعها بـ thumbs/ بنفس اسم الصورة الأصلية.
  function thumbUrl(p) {
    if (p.thumb_path) return storageUrl(p.thumb_path);
    if (/^products\//.test(p.image_path || '')) return storageUrl(p.image_path.replace(/^products\//, 'thumbs/'));
    return storageUrl(p.image_path);
  }

  // ملف JS عند الحاجة بس (البيانات التجريبية). <script> يشتغل من file:// بعكس fetch
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function fetchJson(url, opts) {
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : 0;
    opts = opts || {};
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (err) { clearTimeout(timer); throw err; });
  }

  function loadProducts() {
    if (hasSupabase()) {
      isDemo = false;
      var url = cfg.SUPABASE_URL.replace(/\/+$/, '') +
        '/rest/v1/products?select=*&order=created_at.desc';  // * حتى ما ينكسر لو عمود is_featured لسا ما انضاف
      return fetchJson(url, { headers: { apikey: cfg.SUPABASE_ANON_KEY, Accept: 'application/json' } });
    }
    isDemo = true;
    return (window.RASHF_SAMPLE ? Promise.resolve() : loadScript(SAMPLE_URL)).then(function () {
      var d = window.RASHF_SAMPLE || {};
      return (d.products || []).slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    });
  }

  function formatPrice(n) {
    var num = Number(n);
    if (!isFinite(num)) return '';
    return t('price.format', { n: num.toFixed(3) });
  }

  function name(p) { return (lang === 'en' ? p.name_en : p.name_ar) || p.name_ar || p.name_en || ''; }
  function descOf(p) { return (lang === 'en' ? p.desc_en : p.desc_ar) || ''; }

  function showState(state) {
    $('menu-empty').hidden = state !== 'empty';
    $('menu-error').hidden = state !== 'error';
    grid.hidden = state === 'empty' || state === 'error';
    grid.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  }

  var revealObserver = null;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    root.classList.add('js-reveal');
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); revealObserver.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  }

  function columns() {
    return 2;
  }

  /* ---------------- الصور ---------------- */

  function featuredOf(list) {
    for (var i = 0; i < list.length; i++) if (list[i].is_featured) return list[i];
    return null;
  }

  // عرض الصورة بكل مقاس حتى المتصفح يختار أصغر ملف يكفي الشاشة وكثافتها
  var CARD_SIZES = '(min-width: 1000px) 448px, 46vw';
  var SHEET_SIZES = '(min-width: 760px) min(46vw, 450px), calc(100vw - 24px)';

  // مقاسات الصورة: image_set ([مسار، عرض]...) لو موجود، وإلا الصغيرة 960 + الكبيرة 1600 من لوحة الأدمن
  function srcsetOf(p) {
    if (p.image_set && p.image_set.length) {
      return p.image_set.map(function (s) { return storageUrl(s[0]) + ' ' + s[1] + 'w'; }).join(', ');
    }
    var full = storageUrl(p.image_path), thumb = thumbUrl(p);
    return full && full !== thumb ? thumb + ' 960w, ' + full + ' 1600w' : '';
  }

  function cardImage(p, li) {
    var img = document.createElement('img');
    img.className = 'card__photo';
    img.alt = '';  // الاسم مكتوب تحت الصورة داخل نفس الزر
    img.width = 960;
    img.height = 1200;
    img.decoding = 'async';
    img.loading = 'lazy';
    var full = storageUrl(p.image_path);
    var thumb = thumbUrl(p);
    var done = function () { li.classList.add('is-loaded'); };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', function onErr() {
      img.removeEventListener('error', onErr);
      img.removeAttribute('srcset');
      if (full && img.src !== full) img.src = full; else done();
    });
    var set = srcsetOf(p);
    if (set) {
      img.sizes = CARD_SIZES;
      img.srcset = set;
    }
    img.src = thumb;
    return img;
  }

  function renderProducts(animate) {
    var cols = columns();
    var frag = document.createDocumentFragment();
    var star = featuredOf(products);
    // الترتيب نفسه (الأحدث أول)؛ الأكثر طلباً بس ياخذ شارة
    var order = products.slice();

    // بطاقة أخيرة لحالها بالصف: بالجوال تتمدد أفقياً، وبالشاشات الأكبر تتوسّط (ما يبقى فراغ مايل)
    var rest = order.length;
    order.forEach(function (p, i) {
      var featured = p === star;
      var li = document.createElement('li');
      var solo = '';
      if (i === order.length - 1) {
        if (rest % 2 === 1) solo += ' card--solo2';
      }
      li.className = 'card' + (featured ? ' card--featured' : '') + solo + (animate ? '' : ' is-in');
      li.style.setProperty('--d', String(i % cols));

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card__btn';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.dataset.index = String(products.indexOf(p));

      var media = document.createElement('span');
      media.className = 'card__media';
      media.appendChild(cardImage(p, li));

      var info = document.createElement('span');
      info.className = 'card__info';
      if (featured) {
        var badge = document.createElement('span');
        badge.className = 'card__badge';
        badge.textContent = t('badge.best');
        info.appendChild(badge);
      }
      var nm = document.createElement('span');
      nm.className = 'card__name';
      nm.textContent = name(p);
      info.appendChild(nm);
      var pr = document.createElement('span');
      pr.className = 'card__price';
      pr.textContent = formatPrice(p.price);
      info.appendChild(pr);

      btn.appendChild(media);
      btn.appendChild(info);
      li.appendChild(btn);
      frag.appendChild(li);

    });

    grid.replaceChildren(frag);
    if (animate && revealObserver) grid.querySelectorAll('.card').forEach(function (c) { revealObserver.observe(c); });
  }

  function showProducts(waitFor) {
    showState('loading');
    Promise.all([loadProducts(), waitFor]).then(function (res) {
      var list = res[0];
      products = Array.isArray(list) ? list.filter(function (p) { return p && p.image_path; }) : [];
      if (!products.length) { grid.replaceChildren(); showState('empty'); return; }
      renderProducts(true);
      showState('ready');
    }).catch(function (err) {
      console.warn('[rashf] تعذّر تحميل المنتجات:', err && err.message ? err.message : err);
      products = [];
      showState('error');
    });
  }

  /* ---------------- نافذة المنتج ---------------- */

  function fillDialog(p) {
    var img = $('sheet-img');
    $('sheet-title').textContent = name(p);
    $('sheet-price').textContent = formatPrice(p.price);
    $('sheet-desc').textContent = descOf(p);
    img.alt = name(p);
  }

  /* النافذة: المتصفح يختار من srcset المقاس اللي يكفي عرض النافذة × كثافة الشاشة، والصورة تطلع بنعومة لما تجهز */
  function openDialog(p, trigger) {
    if (!dialog || typeof dialog.showModal !== 'function') return;
    current = p;
    lastTrigger = trigger || null;
    fillDialog(p);

    var img = $('sheet-img');
    var set = srcsetOf(p);
    img.classList.remove('is-loaded');
    img.removeAttribute('src');
    img.removeAttribute('srcset');
    img.addEventListener('load', function () { if (current === p) img.classList.add('is-loaded'); }, { once: true });
    if (set) {
      img.sizes = SHEET_SIZES;
      img.srcset = set;
    }
    img.src = storageUrl(p.image_path) || thumbUrl(p);

    try { history.pushState({ rashfModal: true }, ''); } catch (e) { /* ignore */ }
    dialog.classList.remove('is-closing');
    dialog.showModal();
    root.classList.add('modal-open');
    $('sheet-close').focus();
  }

  var closing = false;
  function finishClose() {
    if (!dialog.open) return;
    if (closing) return;
    closing = true;
    var end = function () {
      dialog.classList.remove('is-closing');
      dialog.close();
      root.classList.remove('modal-open');
      current = null;
      closing = false;
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true });
    };
    if (reduceMotion) { end(); return; }
    dialog.classList.add('is-closing');
    setTimeout(end, 220);
  }

  // الإغلاق يمرّ دايماً عبر history حتى يكون زر الرجوع بالجوال والـ X نفس السلوك
  function requestClose() {
    if (history.state && history.state.rashfModal) history.back();
    else finishClose();
  }

  function initDialog() {
    if (!dialog) return;
    $('sheet-close').addEventListener('click', requestClose);
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); requestClose(); });   // Esc
    dialog.addEventListener('click', function (e) { if (e.target === dialog) requestClose(); });  // برا النافذة
    window.addEventListener('popstate', function () { if (dialog.open) finishClose(); });

    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('.card__btn');
      if (!btn) return;
      var p = products[Number(btn.dataset.index)];
      if (p) openDialog(p, btn);
    });
  }

  /* ---------------- رابط الإنستجرام (زر الطلب بآخر الصفحة) ---------------- */

  function initInstagram() {
    var footerLink = $('footer-ig');
    if (footerLink && cfg.INSTAGRAM_URL) footerLink.href = cfg.INSTAGRAM_URL;
  }

  /* ---------------- البداية ---------------- */

  initTheme();
  initHero();
  initDialog();
  initInstagram();

  var toggle = document.querySelector('.lang-toggle');
  if (toggle) toggle.addEventListener('click', function () { setLang(lang === 'ar' ? 'en' : 'ar'); });
  $('menu-retry').addEventListener('click', function () { showProducts(); });

  applyLang(lang);
  showProducts();
})();
