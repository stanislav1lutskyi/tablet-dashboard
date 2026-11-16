/* Домашнє табло — основна логіка.
 * Навмисно написано в стилі ES5 (var, XMLHttpRequest, колбеки) для старих Android-браузерів. */
(function () {
  'use strict';

  /* ====================== Константи ====================== */
  var LS_SETTINGS = 'sd_settings_v1';
  var LS_MANUAL = 'sd_power_manual_v1';
  var LS_CACHE = 'sd_cache_v1';

  var OBLASTS = ['Автономна Республіка Крим', 'Вінницька область', 'Волинська область', 'Дніпропетровська область',
    'Донецька область', 'Житомирська область', 'Закарпатська область', 'Запорізька область', 'Івано-Франківська область',
    'Київська область', 'Кіровоградська область', 'Луганська область', 'Львівська область', 'Миколаївська область',
    'Одеська область', 'Полтавська область', 'Рівненська область', 'Сумська область', 'Тернопільська область',
    'Харківська область', 'Херсонська область', 'Хмельницька область', 'Черкаська область', 'Чернівецька область',
    'Чернігівська область', 'м. Київ', 'м. Севастополь'];

  var MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  var WEEKDAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'];
  var WD_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  var DEFAULTS = {
    city: 'Івано-Франківськ', lat: 48.9226, lon: 24.7103, weatherMin: 15,
    oblast: 'Івано-Франківська область', alertLocal: '', alertToken: '', alertBase: '', alertSec: 45,
    operator: 'Прикарпаттяобленерго', operatorCustom: '', powerRegion: 'Івано-Франківська область',
    powerCity: '', group: '', powerUrl: '',
    clock24: true, sound: true, volume: 70,
    nightOn: false, nightFrom: 23, nightTo: 6,
    show: { clock: true, weather: true, alert: true, power: true }
  };

  /* ====================== Утиліти ====================== */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function now() { return new Date().getTime(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* переповнення — ігноруємо */ } }
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function merge(base, over) {
    var out = clone(base), k;
    if (!over) return out;
    for (k in over) {
      if (!over.hasOwnProperty(k)) continue;
      if (out[k] && typeof out[k] === 'object' && !(out[k] instanceof Array)) {
        var sub = over[k], kk;
        for (kk in sub) if (sub.hasOwnProperty(kk)) out[k][kk] = sub[kk];
      } else out[k] = over[k];
    }
    return out;
  }

  var settings = merge(DEFAULTS, lsGet(LS_SETTINGS, null));
  var manual = lsGet(LS_MANUAL, { tpl: { off: '', maybe: '' }, days: {} });
  if (!manual.tpl) manual.tpl = { off: '', maybe: '' };
  if (!manual.days) manual.days = {};
  var cache = lsGet(LS_CACHE, {});

  /* ====================== Київський час ====================== */
  var dtf = null;
  (function initDtf() {
    var zones = ['Europe/Kyiv', 'Europe/Kiev'], i;
    for (i = 0; i < zones.length; i++) {
      try {
        var f = new Intl.DateTimeFormat('en-GB', { timeZone: zones[i], hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (f.formatToParts) { f.formatToParts(new Date()); dtf = f; return; }
      } catch (e) { /* пробуємо наступну назву */ }
    }
  })();

  // Повертає компоненти дати/часу в Europe/Kyiv (або в локальному часі пристрою, якщо Intl недоступний)
  function kyiv(date) {
    date = date || new Date();
    var p = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 };
    if (dtf) {
      var parts = dtf.formatToParts(date), i, m = {};
      for (i = 0; i < parts.length; i++) m[parts[i].type] = parts[i].value;
      p.y = +m.year; p.mo = +m.month; p.d = +m.day; p.h = +m.hour % 24; p.mi = +m.minute; p.s = +m.second;
    } else {
      p.y = date.getFullYear(); p.mo = date.getMonth() + 1; p.d = date.getDate(); p.h = date.getHours(); p.mi = date.getMinutes(); p.s = date.getSeconds();
    }
    p.wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    p.key = p.y + '-' + pad(p.mo) + '-' + pad(p.d);
    return p;
  }
  function addDaysKey(key, n) {
    var a = key.split('-');
    var d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function hhmm(date) { var p = kyiv(date); return pad(p.h) + ':' + pad(p.mi); }
  function minToStr(m) { m = Math.round(m); if (m >= 1440) m -= 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  /* ====================== Масштабування під екран ====================== */
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var rem = Math.min(w / 80, h / 50);
    if (rem < 7) rem = 7;
    document.documentElement.style.fontSize = rem + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ====================== XHR ====================== */
  function getJSON(url, timeoutMs, cb) {
    var done = false, xhr = new XMLHttpRequest();
    function finish(err, data, status) { if (done) return; done = true; cb(err, data, status); }
    try {
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs || 15000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { finish(null, JSON.parse(xhr.responseText), xhr.status); } catch (e) { finish('parse', null, xhr.status); }
        } else finish('http', null, xhr.status);
      };
      xhr.onerror = function () { finish('network', null, 0); };
      xhr.ontimeout = function () { finish('timeout', null, 0); };
      xhr.send();
    } catch (e) { finish('network', null, 0); }
  }

  /* ====================== Стан підключення та синхронізації ====================== */
  var lastOk = { weather: cache.weatherAt || 0, alerts: 0, power: cache.powerAt || 0 };
  function lastAnyOk() { return Math.max(lastOk.weather, lastOk.alerts, lastOk.power); }
  function renderStatusBar() {
    var t = lastAnyOk();
    setText($('sbSync'), t ? hhmm(new Date(t)) : '—');
    var online = (typeof navigator.onLine === 'boolean' ? navigator.onLine : true) && (now() - Math.max(lastAnyOk(), startedAt) < 5 * 60 * 1000);
    var el = $('sbNet');
    setText(el, 'Інтернет: ' + (online ? 'Підключено' : 'Немає зв’язку'));
    el.className = 'net ' + (online ? 'net-ok' : 'net-bad');
  }
  var startedAt = now();

  /* ====================== Годинник ====================== */
  var lastDateKey = '';
  function renderClock() {
    var p = kyiv();
    var h = p.h, ampm = '';
    if (!settings.clock24) { ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12; }
    setText($('clockTime'), (settings.clock24 ? pad(h) : String(h)) + ':' + pad(p.mi) + ':' + pad(p.s));
    setText($('clockAmpm'), ampm);
    if (p.key !== lastDateKey) {
      lastDateKey = p.key;
      setText($('clockWeekday'), WEEKDAYS[p.wd].toUpperCase());
      setText($('clockDate'), (p.d + ' ' + MONTHS[p.mo - 1] + ' ' + p.y).toUpperCase());
      renderPower(true);
      if (cache.weather) renderWeather();
    }
  }

  /* ====================== Погода ====================== */
  var WCODES = {
    0: ['Ясно', 'clear'], 1: ['Переважно ясно', 'clear'], 2: ['Мінлива хмарність', 'partly'], 3: ['Хмарно', 'cloud'],
    45: ['Туман', 'fog'], 48: ['Паморозний туман', 'fog'],
    51: ['Легка мряка', 'rain'], 53: ['Мряка', 'rain'], 55: ['Сильна мряка', 'rain'], 56: ['Крижана мряка', 'rain'], 57: ['Крижана мряка', 'rain'],
    61: ['Слабкий дощ', 'rain'], 63: ['Дощ', 'rain'], 65: ['Сильний дощ', 'rain'], 66: ['Крижаний дощ', 'rain'], 67: ['Крижаний дощ', 'rain'],
    71: ['Слабкий сніг', 'snow'], 73: ['Сніг', 'snow'], 75: ['Сильний сніг', 'snow'], 77: ['Снігова крупа', 'snow'],
    80: ['Слабкі зливи', 'rain'], 81: ['Зливи', 'rain'], 82: ['Сильні зливи', 'rain'], 85: ['Снігопад', 'snow'], 86: ['Сильний снігопад', 'snow'],
    95: ['Гроза', 'storm'], 96: ['Гроза з градом', 'storm'], 99: ['Гроза з градом', 'storm']
  };
  var CLOUD = '<path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5 4.25 4.25 0 0 0 7 18z"/>';
  var ICONS = {
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    night: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    partly: '<circle cx="8" cy="8" r="2.8"/><path d="M8 2.2v1.3M2.2 8h1.3M3.9 3.9l.9.9M12.1 3.9l-.9.9"/><path d="M9 20h9a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9.4 13 3.5 3.5 0 0 0 9 20z"/>',
    cloud: CLOUD,
    fog: '<path d="M5 9h14M3 13h18M6 17h12"/>',
    rain: CLOUD + '<path d="M8 20.5l.8-2M12 20.5l.8-2M16 20.5l.8-2"/>',
    snow: CLOUD + '<path d="M8 19.5h.01M12 20.5h.01M16 19.5h.01"/>',
    storm: CLOUD + '<path d="M12.5 15.5l-2 3h3l-2 3"/>'
  };
  function wInfo(code, isDay) {
    var i = WCODES[code] || ['—', 'cloud'];
    var kind = i[1];
    if (kind === 'clear' && isDay === 0) kind = 'night';
    return { text: i[0], svg: '<svg viewBox="0 0 24 24">' + ICONS[kind] + '</svg>' };
  }
  function fmtT(v) { if (v === null || v === undefined || isNaN(v)) return '—'; var r = Math.round(v); return (r > 0 ? '+' : '') + r + '°'; }

  function weatherUrl() {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(settings.lat) + '&longitude=' + encodeURIComponent(settings.lon) +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&wind_speed_unit=ms&timezone=auto&forecast_days=4';
  }

  function fetchWeather(cb) {
    getJSON(weatherUrl(), 15000, function (err, data) {
      if (!err && data && data.current) {
        cache.weather = data; cache.weatherAt = now(); cache.weatherKey = settings.lat + ',' + settings.lon;
        lsSet(LS_CACHE, cache);
        lastOk.weather = cache.weatherAt;
        $('wMsg').textContent = '';
        renderWeather();
      } else {
        weatherFail(err);
      }
      renderStatusBar();
      if (cb) cb();
    });
  }
  function weatherFail(err) {
    var age = cache.weatherAt ? Math.round((now() - cache.weatherAt) / 60000) : null;
    if (cache.weather) {
      var txt = 'Не вдалося оновити погоду' + (err === 'network' || err === 'timeout' ? ' (немає зв’язку)' : '') + '. Показано дані від ' + hhmm(new Date(cache.weatherAt)) + (age > 120 ? ' — вони застарілі' : '') + '.';
      $('wMsg').textContent = txt;
    } else {
      setText($('wCond'), 'Немає даних');
      $('wMsg').textContent = 'Не вдалося отримати погоду' + (err === 'network' || err === 'timeout' ? ': немає зв’язку' : '') + '. Повторна спроба автоматично.';
    }
  }

  function renderWeather() {
    var d = cache.weather;
    if (!d || !d.current) return;
    var c = d.current;
    var info = wInfo(c.weather_code, c.is_day);
    setText($('wCity'), settings.city || '');
    $('wIcon').innerHTML = info.svg;
    setText($('wTemp'), fmtT(c.temperature_2m).replace('°', '°C'));
    setText($('wCond'), info.text);
    setText($('wFeels'), fmtT(c.apparent_temperature) + 'C');
    setText($('wWind'), (c.wind_speed_10m !== undefined ? Math.round(c.wind_speed_10m * 10) / 10 : '—') + ' м/с');
    setText($('wHum'), (c.relative_humidity_2m !== undefined ? Math.round(c.relative_humidity_2m) : '—') + '%');

    // Прогноз на найближчі години (крок 2 год, 5 позицій)
    var html = '', h = d.hourly;
    if (h && h.time) {
      var p = kyiv(), nowStr = p.key + 'T' + pad(p.h) + ':00', start = -1, i;
      for (i = 0; i < h.time.length; i++) { if (h.time[i] > nowStr) { start = i; break; } }
      if (start >= 0) {
        var n = 0;
        for (i = start; i < h.time.length && n < 5; i += 2, n++) {
          var hi = wInfo(h.weather_code[i], h.is_day ? h.is_day[i] : 1);
          var pp = h.precipitation_probability ? h.precipitation_probability[i] : null;
          html += '<div><div class="t">' + h.time[i].substr(11, 5) + '</div><div class="wi">' + hi.svg + '</div><div class="v">' + fmtT(h.temperature_2m[i]) + '</div><div class="pp">' + (pp >= 30 ? pp + '%' : '') + '</div></div>';
        }
      }
    }
    $('wHourly').innerHTML = html;

    // Наступні 3 дні
    html = '';
    var dd = d.daily;
    if (dd && dd.time) {
      var j;
      for (j = 1; j < dd.time.length && j <= 3; j++) {
        var a = dd.time[j].split('-'), wd = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay();
        var di = wInfo(dd.weather_code[j], 1);
        html += '<div><div class="t">' + WD_SHORT[wd] + ', ' + (+a[2]) + '.' + a[1] + '</div><div class="wi">' + di.svg + '</div><div class="v">' + fmtT(dd.temperature_2m_max[j]) + ' <small>' + fmtT(dd.temperature_2m_min[j]) + '</small></div></div>';
      }
    }
    $('wDaily').innerHTML = html;
  }

  /* ====================== Повітряна тривога ====================== */
  var alertState = { kind: 'gray', startedAt: null, since: 0, text: '', scope: '' };
  var prevKind = null;
  var lastGoodAlert = cache.alert || null; // { kind, startedAt, at }

  function alertsUrl() {
    var base = (settings.alertBase || 'https://api.alerts.in.ua').replace(/\/+$/, '');
    var url = base + '/v1/alerts/active.json';
    if (settings.alertToken) url += '?token=' + encodeURIComponent(settings.alertToken);
    return url;
  }

  function fetchAlerts(cb) {
    if (!settings.alertToken && !settings.alertBase) {
      applyAlert({ kind: 'gray', text: 'НЕМАЄ ДАНИХ', msg: 'Вкажіть API-токен alerts.in.ua в налаштуваннях (⚙).' }, false);
      if (cb) cb();
      return;
    }
    getJSON(alertsUrl(), 12000, function (err, data, status) {
      if (err || !data || !(data.alerts instanceof Array)) {
        var msg;
        if (status === 401 || status === 403) msg = 'Токен alerts.in.ua не прийнято. Перевірте його в налаштуваннях.';
        else if (status === 429) msg = 'Забагато запитів до alerts.in.ua. Збільште інтервал оновлення.';
        else if (err === 'network' || err === 'timeout') msg = 'Немає зв’язку із сервісом тривог (або браузер заблокував запит — див. README, розділ CORS).';
        else msg = 'Сервіс тривог повернув несподівану відповідь.';
        alertFailed(msg);
      } else {
        lastOk.alerts = now();
        applyAlert(parseAlerts(data), true);
      }
      renderStatusBar();
      if (cb) cb();
    });
  }

  function parseAlerts(data) {
    var i, a, oblast = settings.oblast, local = (settings.alertLocal || '').toLowerCase();
    var full = [], partial = [], localHit = [];
    for (i = 0; i < data.alerts.length; i++) {
      a = data.alerts[i];
      if (a.alert_type !== 'air_raid') continue;
      if (a.location_oblast !== oblast && a.location_title !== oblast) continue;
      var isFull = a.location_type === 'oblast' || a.location_title === oblast;
      if (isFull) full.push(a);
      else {
        partial.push(a);
        if (local && String(a.location_title || '').toLowerCase().indexOf(local) !== -1) localHit.push(a);
      }
    }
    function earliest(list) {
      var best = null, k, t;
      for (k = 0; k < list.length; k++) { t = new Date(list[k].started_at).getTime(); if (!isNaN(t) && (best === null || t < best)) best = t; }
      return best;
    }
    if (full.length) return { kind: 'red', startedAt: earliest(full), scope: oblast };
    if (localHit.length) return { kind: 'red', startedAt: earliest(localHit), scope: localHit[0].location_title };
    if (partial.length) {
      var names = [], k;
      for (k = 0; k < partial.length; k++) names.push(partial[k].location_title);
      return { kind: 'orange', startedAt: earliest(partial), scope: names.join(', ') };
    }
    return { kind: 'green' };
  }

  function alertFailed(msg) {
    // Якщо востаннє була тривога і зв'язок пропав — безпечніше не «зеленити» статус
    if (lastGoodAlert && lastGoodAlert.kind === 'red' && now() - lastGoodAlert.at < 30 * 60 * 1000) {
      applyAlert({ kind: 'red', startedAt: lastGoodAlert.startedAt, scope: lastGoodAlert.scope, stale: true, msg: 'Немає зв’язку: показано останній відомий стан від ' + hhmm(new Date(lastGoodAlert.at)) + '. Дані можуть бути застарілими.' }, false);
    } else {
      applyAlert({ kind: 'gray', text: 'НЕМАЄ ЗВ’ЯЗКУ', msg: msg }, false);
    }
  }

  function applyAlert(r, ok) {
    if (ok) {
      lastGoodAlert = { kind: r.kind, startedAt: r.startedAt || null, scope: r.scope || '', at: now() };
      cache.alert = lastGoodAlert; lsSet(LS_CACHE, cache);
    }
    alertState = r;
    renderAlert();
    if (prevKind !== null && prevKind !== r.kind && !r.stale) onAlertChange(prevKind, r.kind);
    if (!r.stale) prevKind = r.kind;
    else if (prevKind === null) prevKind = 'red';
  }

  function renderAlert() {
    var r = alertState, card = $('cardAlert');
    var cls = { green: 'state-green', red: 'state-red', orange: 'state-orange', gray: 'state-gray' }[r.kind];
    var wantClass = 'card alert ' + cls;
    if (card.className !== wantClass) card.className = wantClass;
    var status = r.text, details = '';
    if (r.kind === 'green') status = 'НЕБЕЗПЕКИ НЕМАЄ';
    if (r.kind === 'red') status = 'ПОВІТРЯНА ТРИВОГА';
    if (r.kind === 'orange') status = 'ТРИВОГА В РАЙОНАХ ОБЛАСТІ';
    setText($('aStatus'), status || '');
    setText($('aRegion'), settings.oblast + (r.kind === 'red' && r.scope && r.scope !== settings.oblast ? ' · ' + r.scope : ''));
    if (r.kind === 'red' || r.kind === 'orange') {
      if (r.startedAt) {
        var p = kyiv(new Date(r.startedAt)), today = kyiv().key;
        details = 'Почалась: ' + pad(p.h) + ':' + pad(p.mi) + (p.key !== today ? ' (' + p.d + '.' + pad(p.mo) + ')' : '') + ' · Триває: ' + durationStr(now() - r.startedAt);
      }
      if (r.kind === 'orange') details = (r.scope || '') + (details ? '\n' + details : '');
    } else if (r.kind === 'green' && lastOk.alerts) {
      details = 'Перевірено о ' + hhmm(new Date(lastOk.alerts));
    }
    var det = $('aDetails');
    if (det.textContent !== details) { det.textContent = details; det.style.whiteSpace = 'pre-line'; }
    setText($('aMsg'), r.msg || '');
    setText($('aUpdated'), lastOk.alerts ? 'оновлено ' + hhmm(new Date(lastOk.alerts)) : '');
    var alarm = r.kind === 'red';
    $('alarmBanner').hidden = !alarm;
    if (alarm) document.body.className = document.body.className.replace(/\balarm\b/, '') + ' alarm'; else document.body.className = document.body.className.replace(/\balarm\b/g, '').replace(/\bblink\b/g, '');
    applyDim();
  }
  function durationStr(ms) {
    if (ms < 0) ms = 0;
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    m = m % 60;
    if (h >= 24) return Math.floor(h / 24) + ' д ' + (h % 24) + ' год';
    return h > 0 ? h + ' год ' + m + ' хв' : m + ' хв';
  }

  /* ====================== Звук (WebAudio, без файлів) ====================== */
  var actx = null, audioUnlocked = false, alarmTimer = null;
  function getCtx() {
    if (actx) return actx;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { actx = new C(); } catch (e) { actx = null; }
    return actx;
  }
  function unlockAudio() {
    var c = getCtx();
    if (!c) return;
    if (c.state === 'suspended' && c.resume) c.resume();
    audioUnlocked = true;
    updateSoundHint();
  }
  function updateSoundHint() {
    var c = actx;
    var running = c && c.state === 'running';
    $('sbSound').hidden = !(settings.sound && !running);
  }
  function beep(freq, startOffset, dur, vol) {
    var c = getCtx();
    if (!c || c.state !== 'running') return;
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + startOffset;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function vol() { return Math.max(0, Math.min(1, settings.volume / 100)) * 0.8; }
  function playAlarmTone() {
    if (!settings.sound) return;
    var v = vol(), i;
    for (i = 0; i < 3; i++) { beep(660, i * 1.1, 0.5, v); beep(880, i * 1.1 + 0.5, 0.5, v); }
  }
  function playClearTone() {
    if (!settings.sound) return;
    var v = vol();
    beep(523, 0, 0.25, v); beep(659, 0.28, 0.25, v); beep(784, 0.56, 0.45, v);
  }
  function onAlertChange(from, to) {
    if (to === 'red') {
      playAlarmTone();
      if (alarmTimer) clearInterval(alarmTimer);
      alarmTimer = setInterval(function () { if (alertState.kind === 'red') playAlarmTone(); else { clearInterval(alarmTimer); alarmTimer = null; } }, 15000);
    } else if (from === 'red' && to === 'green') {
      playClearTone();
    }
  }
  document.addEventListener('touchstart', unlockAudio, false);
  document.addEventListener('click', unlockAudio, false);

  /* ====================== Графік відключень ====================== */
  var remotePower = cache.powerRemote || null; // { days: {date:{off:[],maybe:[]}}, updated: '' }

  // "06:00-10:00, 18:00-22:00" -> {list:[[360,600],[1080,1320]]} або {error:'…'}
  function parseIntervals(str) {
    var out = [], parts = String(str || '').split(/[,;\n]+/), i;
    for (i = 0; i < parts.length; i++) {
      var s = parts[i].replace(/\s+/g, '');
      if (!s) continue;
      var m = /^(\d{1,2}):(\d{2})[-–—](\d{1,2}):(\d{2})$/.exec(s);
      if (!m) return { error: 'Некоректний інтервал «' + parts[i].trim() + '». Потрібен формат ГГ:ХХ-ГГ:ХХ.' };
      var a = (+m[1]) * 60 + (+m[2]), b = (+m[3]) * 60 + (+m[4]);
      if (+m[1] > 24 || +m[3] > 24 || +m[2] > 59 || +m[4] > 59 || a > 1440 || b > 1440) return { error: 'Некоректний час в «' + parts[i].trim() + '».' };
      if (b === 0 && a > 0) b = 1440;
      if (b <= a) return { error: 'В «' + parts[i].trim() + '» кінець має бути пізніше за початок. Для переходу через північ розділіть інтервал на два дні.' };
      out.push([a, b]);
    }
    return { list: out };
  }

  // Дані за дату: { known, off:[[s,e]], maybe:[[s,e]], source }
  function dayData(key) {
    var md = manual.days[key];
    if (md && md.known) return { known: true, off: parseIntervals(md.off).list || [], maybe: parseIntervals(md.maybe).list || [], source: 'вручну' };
    var rd = remoteDays()[key];
    if (rd) return { known: true, off: toIntervals(rd.off), maybe: toIntervals(rd.maybe), source: 'джерело' };
    var t = manual.tpl;
    if (t && (String(t.off).replace(/\s/g, '') || String(t.maybe).replace(/\s/g, ''))) {
      return { known: true, off: parseIntervals(t.off).list || [], maybe: parseIntervals(t.maybe).list || [], source: 'шаблон' };
    }
    return { known: false, off: [], maybe: [], source: '' };
  }
  function toIntervals(arr) {
    var r = parseIntervals((arr || []).join(','));
    return r.list || [];
  }
  function remoteDays() {
    if (!remotePower) return {};
    if (remotePower.groups && settings.group && remotePower.groups[settings.group]) return remotePower.groups[settings.group].days || {};
    return remotePower.days || {};
  }

  function mergeSegs(list) {
    list.sort(function (x, y) { return x[0] - y[0]; });
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      if (out.length && list[i][0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], list[i][1]);
      else out.push([list[i][0], list[i][1]]);
    }
    return out;
  }

  function computePower() {
    var p = kyiv(), todayKey = p.key, tomKey = addDaysKey(todayKey, 1);
    var t = dayData(todayKey), tm = dayData(tomKey);
    var nowMin = p.h * 60 + p.mi + p.s / 60;
    var res = { today: t, tomorrow: tm, todayKey: todayKey, tomKey: tomKey, nowMin: nowMin, status: 'gray', text: 'Немає даних', next: '—', restore: '—', showRestore: false };
    if (!t.known) return res;

    // Відключення одним списком на 48 годин (сьогодні + завтра)
    var offs = t.off.slice(), maybes = t.maybe.slice(), i;
    if (tm.known) {
      for (i = 0; i < tm.off.length; i++) offs.push([tm.off[i][0] + 1440, tm.off[i][1] + 1440]);
      for (i = 0; i < tm.maybe.length; i++) maybes.push([tm.maybe[i][0] + 1440, tm.maybe[i][1] + 1440]);
    }
    offs = mergeSegs(offs); maybes = mergeSegs(maybes);

    var cur = null, nextOff = null;
    for (i = 0; i < offs.length; i++) {
      if (nowMin >= offs[i][0] && nowMin < offs[i][1]) { cur = offs[i]; break; }
      if (offs[i][0] > nowMin && nextOff === null) nextOff = offs[i];
    }
    if (cur) {
      res.status = 'red'; res.text = 'Світла немає'; res.showRestore = true;
      res.restore = minToStr(cur[1]) + (cur[1] >= 1440 && cur[1] - 1440 > 0 ? ' (завтра)' : '');
      if (cur[1] === 1440 && !tm.known) res.restore = 'після 24:00 (дані на завтра відсутні)';
      var after = null;
      for (i = 0; i < offs.length; i++) { if (offs[i][0] >= cur[1]) { after = offs[i]; break; } }
      if (after) res.next = minToStr(after[0]) + (after[0] >= 1440 ? ' (завтра)' : '');
      else res.next = tm.known ? 'не заплановано' : 'до кінця доби немає';
      return res;
    }
    var inMaybe = false;
    for (i = 0; i < maybes.length; i++) { if (nowMin >= maybes[i][0] && nowMin < maybes[i][1]) { inMaybe = true; break; } }
    if (inMaybe) { res.status = 'yellow'; res.text = 'Можливе відключення'; }
    else { res.status = 'green'; res.text = 'Світло є'; }
    if (nextOff) res.next = minToStr(nextOff[0]) + (nextOff[0] >= 1440 ? ' (завтра)' : '');
    else res.next = tm.known ? 'не заплановано' : 'до кінця доби немає';
    return res;
  }

  var barKey = '';
  function buildBar(el, data) {
    var html = '', i, seg;
    for (i = 1; i < 24; i++) html += '<div class="tick" style="left:' + (i * 100 / 24) + '%"></div>';
    function add(list, cls) {
      var k;
      for (k = 0; k < list.length; k++) {
        html += '<div class="seg ' + cls + '" style="left:' + (list[k][0] * 100 / 1440) + '%;width:' + ((list[k][1] - list[k][0]) * 100 / 1440) + '%"></div>';
      }
    }
    if (data.known) { add(data.maybe, 'maybe'); add(data.off, 'off'); }
    el.className = 'bar' + (data.known ? ' known' : '');
    el.innerHTML = html + '<div class="now" style="display:none"></div>';
  }

  function renderPower(force) {
    var r = computePower();
    var key = [r.todayKey, JSON.stringify(r.today), JSON.stringify(r.tomorrow)].join('|');
    if (force || key !== barKey) {
      barKey = key;
      buildBar($('barToday'), r.today);
      buildBar($('barTomorrow'), r.tomorrow);
      // підписи годин
      var sc = '', i;
      for (i = 0; i < 24; i += 2) sc += '<span style="left:' + (i * 100 / 24) + '%">' + pad(i) + '</span>';
      $('pScale').innerHTML = sc;
    }
    var nowEl = $('barToday').lastChild;
    if (nowEl && nowEl.className === 'now') { nowEl.style.display = 'block'; nowEl.style.left = (r.nowMin * 100 / 1440) + '%'; }

    var st = $('pStatus'), cls = 'p-status ps-' + r.status;
    if (st.className !== cls) st.className = cls;
    setText(st, r.text);
    setText($('pNext'), r.next);
    setText($('pRestore'), r.restore);
    $('pRestoreRow').style.display = r.showRestore ? '' : 'none';
    setText($('pGroup'), settings.group || '—');
    var op = settings.operator === 'Інший оператор' ? (settings.operatorCustom || 'Інший оператор') : settings.operator;
    var meta = [settings.powerRegion, settings.powerCity || settings.city, op].filter(function (x) { return x; }).join(' · ');
    setText($('pMeta'), meta);
    var src = r.today.known ? ('Джерело: ' + r.today.source) : 'Графік не заданий — додайте його в налаштуваннях (⚙)';
    var upd = manual.savedAt ? ' · збережено ' + hhmm(new Date(manual.savedAt)) : '';
    if (remotePower && remotePower.at && r.today.source === 'джерело') upd = ' · оновлено ' + hhmm(new Date(remotePower.at));
    setText($('pUpdated'), src + upd);
  }

  function fetchPowerRemote(cb) {
    if (!settings.powerUrl) { if (cb) cb(); return; }
    getJSON(settings.powerUrl, 15000, function (err, data) {
      if (!err && data && (data.days || data.groups)) {
        remotePower = { days: data.days || null, groups: data.groups || null, at: now() };
        cache.powerRemote = remotePower; cache.powerAt = now(); lsSet(LS_CACHE, cache);
        lastOk.power = cache.powerAt;
      }
      renderPower(true); renderStatusBar();
      if (cb) cb();
    });
  }

  /* ====================== Нічне затемнення ====================== */
  function applyDim() {
    var dim = $('dim'), on = false;
    if (settings.nightOn && alertState.kind !== 'red') {
      var h = kyiv().h, f = +settings.nightFrom, t = +settings.nightTo;
      on = f <= t ? (h >= f && h < t) : (h >= f || h < t);
    }
    dim.hidden = !on;
  }

  /* ====================== Видимість блоків ====================== */
  function applyVisibility() {
    $('cardClock').style.display = settings.show.clock ? '' : 'none';
    $('cardWeather').style.display = settings.show.weather ? '' : 'none';
    $('cardAlert').style.display = settings.show.alert ? '' : 'none';
    $('cardPower').style.display = settings.show.power ? '' : 'none';
    var midVisible = settings.show.weather || settings.show.alert;
    document.querySelector('.row.mid').style.display = midVisible ? '' : 'none';
  }

  /* ====================== Плани оновлення ====================== */
  var timers = { weather: null, alerts: null, power: null };
  function schedule() {
    var k;
    for (k in timers) if (timers[k]) { clearInterval(timers[k]); timers[k] = null; }
    var aSec = Math.max(30, Math.min(120, +settings.alertSec || 45));
    var wMin = Math.max(5, Math.min(120, +settings.weatherMin || 15));
    timers.alerts = setInterval(function () { fetchAlerts(); }, aSec * 1000);
    timers.weather = setInterval(function () { fetchWeather(); }, wMin * 60000);
    timers.power = setInterval(function () { fetchPowerRemote(); }, 10 * 60000);
  }
  function refreshAll() {
    var btn = $('btnRefresh');
    btn.style.opacity = '.4';
    var left = 3;
    function done() { if (--left === 0) btn.style.opacity = ''; }
    fetchWeather(done); fetchAlerts(done); fetchPowerRemote(done);
  }

  /* ====================== Секундний тік ====================== */
  var tickN = 0, reloadDone = false;
  function tick() {
    tickN++;
    renderClock();
    if (tickN % 15 === 0) {
      renderPower();
      if (alertState.kind === 'red' || alertState.kind === 'orange') renderAlert();
      renderStatusBar();
      applyDim();
    }
    if (alertState.kind === 'red') {
      var b = document.body;
      if (tickN % 2 === 0) { if (!/\bblink\b/.test(b.className)) b.className += ' blink'; } else b.className = b.className.replace(/\s*\bblink\b/g, '');
    }
    // Профілактичне перезавантаження щодня о 04:00 (звільняє пам'ять при роботі 24/7)
    var p = kyiv();
    if (!reloadDone && p.h === 4 && p.mi === 0 && p.s < 5 && now() - startedAt > 10 * 60000 && document.getElementById('viewSettings').hidden) {
      reloadDone = true; location.reload();
    }
  }

  /* ====================== Wake Lock, повний екран ====================== */
  var wakeLock = null;
  function requestWake() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function () { });
      }
    } catch (e) { /* не підтримується */ }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { requestWake(); refreshAll(); } });
  function toggleFullscreen() {
    var d = document, el = d.documentElement;
    var isFs = d.fullscreenElement || d.webkitFullscreenElement;
    if (!isFs) { (el.requestFullscreen || el.webkitRequestFullscreen || function () { }).call(el); }
    else { (d.exitFullscreen || d.webkitExitFullscreen || function () { }).call(d); }
  }

  /* ====================== Налаштування (UI) ====================== */
  function toast(msg, bad) {
    var t = $('setToast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    setTimeout(function () { t.hidden = true; }, 2200);
  }
  function initSettingsForm() {
    var sel = $('fOblast'), i, h = '';
    for (i = 0; i < OBLASTS.length; i++) h += '<option>' + esc(OBLASTS[i]) + '</option>';
    sel.innerHTML = h;
  }
  function v(id) { return $(id).value; }

  function openSettings() {
    var s = settings, today = kyiv().key, tom = addDaysKey(today, 1);
    $('fCity').value = s.city; $('fPowerRegion').value = s.powerRegion; $('fLat').value = s.lat; $('fLon').value = s.lon;
    $('fWeatherMin').value = s.weatherMin;
    $('fOblast').value = s.oblast; $('fAlertLocal').value = s.alertLocal; $('fToken').value = s.alertToken;
    $('fAlertSec').value = s.alertSec; $('fAlertBase').value = s.alertBase;
    $('fOperator').value = s.operator; $('fOperatorCustom').value = s.operatorCustom; $('fGroup').value = s.group;
    $('fPowerCity').value = s.powerCity; $('fPowerUrl').value = s.powerUrl;
    $('fTplOff').value = manual.tpl.off || ''; $('fTplMaybe').value = manual.tpl.maybe || '';
    var td = manual.days[today], tm = manual.days[tom];
    $('lblToday').textContent = 'Сьогодні (' + today.substr(8, 2) + '.' + today.substr(5, 2) + ')';
    $('lblTomorrow').textContent = 'Завтра (' + tom.substr(8, 2) + '.' + tom.substr(5, 2) + ')';
    $('fTodayMode').value = td && td.known ? 'set' : 'auto'; $('fTodayOff').value = td ? td.off : ''; $('fTodayMaybe').value = td ? td.maybe : '';
    $('fTomorrowMode').value = tm && tm.known ? 'set' : 'auto'; $('fTomorrowOff').value = tm ? tm.off : ''; $('fTomorrowMaybe').value = tm ? tm.maybe : '';
    $('fClock24').value = s.clock24 ? '1' : '0'; $('fSound').value = s.sound ? '1' : '0'; $('fVolume').value = s.volume;
    $('fNightOn').value = s.nightOn ? '1' : '0'; $('fNightFrom').value = s.nightFrom; $('fNightTo').value = s.nightTo;
    $('fShowClock').checked = s.show.clock; $('fShowWeather').checked = s.show.weather; $('fShowAlert').checked = s.show.alert; $('fShowPower').checked = s.show.power;
    $('schedErr').hidden = true; $('geoResults').innerHTML = '';
    $('viewDash').hidden = true; $('viewSettings').hidden = false;
    $('viewSettings').querySelector('.set-scroll').scrollTop = 0;
  }
  function closeSettings() { $('viewSettings').hidden = true; $('viewDash').hidden = false; }

  function num(id, min, max, def) {
    var n = parseFloat(String(v(id)).replace(',', '.'));
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  function saveSettings() {
    // 1) Перевірка введених інтервалів
    var checks = [['fTplOff', 'Шаблон: «Світла немає»'], ['fTplMaybe', 'Шаблон: «Можливе відключення»'],
    ['fTodayOff', 'Сьогодні: «Світла немає»'], ['fTodayMaybe', 'Сьогодні: «Можливе відключення»'],
    ['fTomorrowOff', 'Завтра: «Світла немає»'], ['fTomorrowMaybe', 'Завтра: «Можливе відключення»']], i, r;
    for (i = 0; i < checks.length; i++) {
      r = parseIntervals(v(checks[i][0]));
      if (r.error) { var e = $('schedErr'); e.textContent = checks[i][1] + ' — ' + r.error; e.hidden = false; e.scrollIntoView && e.scrollIntoView(); toast('Виправте помилки', true); return; }
    }
    var lat = num('fLat', -90, 90, NaN), lon = num('fLon', -180, 180, NaN);
    if (isNaN(lat) || isNaN(lon)) { toast('Вкажіть коректні координати', true); return; }

    var oldWeather = settings.lat + ',' + settings.lon;
    var s = settings;
    s.city = v('fCity').trim(); s.powerRegion = v('fPowerRegion').trim(); s.lat = lat; s.lon = lon;
    s.weatherMin = num('fWeatherMin', 5, 120, 15);
    s.oblast = v('fOblast'); s.alertLocal = v('fAlertLocal').trim(); s.alertToken = v('fToken').trim();
    s.alertSec = num('fAlertSec', 30, 120, 45); s.alertBase = v('fAlertBase').trim();
    s.operator = v('fOperator'); s.operatorCustom = v('fOperatorCustom').trim(); s.group = v('fGroup').trim();
    s.powerCity = v('fPowerCity').trim(); s.powerUrl = v('fPowerUrl').trim();
    s.clock24 = v('fClock24') === '1'; s.sound = v('fSound') === '1'; s.volume = num('fVolume', 0, 100, 70);
    s.nightOn = v('fNightOn') === '1'; s.nightFrom = num('fNightFrom', 0, 23, 23); s.nightTo = num('fNightTo', 0, 23, 6);
    s.show = { clock: $('fShowClock').checked, weather: $('fShowWeather').checked, alert: $('fShowAlert').checked, power: $('fShowPower').checked };
    lsSet(LS_SETTINGS, s);

    var today = kyiv().key, tom = addDaysKey(today, 1), k;
    manual.tpl = { off: v('fTplOff').trim(), maybe: v('fTplMaybe').trim() };
    if (v('fTodayMode') === 'set') manual.days[today] = { known: true, off: v('fTodayOff').trim(), maybe: v('fTodayMaybe').trim() }; else delete manual.days[today];
    if (v('fTomorrowMode') === 'set') manual.days[tom] = { known: true, off: v('fTomorrowOff').trim(), maybe: v('fTomorrowMaybe').trim() }; else delete manual.days[tom];
    for (k in manual.days) if (manual.days.hasOwnProperty(k) && k < today) delete manual.days[k]; // чистимо минулі дні
    manual.savedAt = now();
    lsSet(LS_MANUAL, manual);

    if (oldWeather !== s.lat + ',' + s.lon) { cache.weather = null; cache.weatherAt = 0; lastOk.weather = 0; lsSet(LS_CACHE, cache); }
    lastGoodAlert = null; prevKind = null; delete cache.alert;

    closeSettings();
    applyVisibility(); schedule(); updateSoundHint();
    lastDateKey = ''; renderClock(); renderPower(true); renderAlert();
    if (cache.weather) renderWeather(); else { setText($('wCond'), 'Завантаження…'); $('wTemp').textContent = '—'; }
    refreshAll();
  }

  function geoSearch() {
    var q = v('fGeoQuery').trim();
    if (!q) return;
    var box = $('geoResults');
    box.innerHTML = '<div>Пошук…</div>';
    getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=uk&format=json', 12000, function (err, data) {
      if (err || !data) { box.innerHTML = '<div>Не вдалося виконати пошук (немає зв’язку?). Введіть координати вручну.</div>'; return; }
      if (!data.results || !data.results.length) { box.innerHTML = '<div>Нічого не знайдено.</div>'; return; }
      var html = '', i, r;
      for (i = 0; i < data.results.length; i++) {
        r = data.results[i];
        html += '<div data-i="' + i + '">' + esc(r.name) + (r.admin1 ? ', ' + esc(r.admin1) : '') + (r.country ? ' — ' + esc(r.country) : '') + ' (' + r.latitude.toFixed(3) + ', ' + r.longitude.toFixed(3) + ')</div>';
      }
      box.innerHTML = html;
      box.onclick = function (ev) {
        var t = ev.target; while (t && t !== box && !t.getAttribute('data-i')) t = t.parentNode;
        if (!t || t === box) return;
        var res = data.results[+t.getAttribute('data-i')];
        $('fCity').value = res.name; $('fLat').value = res.latitude; $('fLon').value = res.longitude;
        if (res.admin1) {
          $('fPowerRegion').value = res.admin1;
          var j;
          for (j = 0; j < OBLASTS.length; j++) if (OBLASTS[j] === res.admin1) { $('fOblast').value = res.admin1; break; }
        }
        box.innerHTML = '<div>Обрано: ' + esc(res.name) + '. Не забудьте натиснути «Зберегти».</div>';
      };
    });
  }

  /* ====================== Ініціалізація ====================== */
  function init() {
    initSettingsForm();
    $('btnSettings').addEventListener('click', openSettings);
    $('setCancel').addEventListener('click', closeSettings);
    $('setSave').addEventListener('click', saveSettings);
    $('btnRefresh').addEventListener('click', refreshAll);
    $('btnFull').addEventListener('click', toggleFullscreen);
    $('btnGeo').addEventListener('click', geoSearch);
    $('btnTestSound').addEventListener('click', function () {
      unlockAudio();
      var saved = settings.sound, sv = settings.volume;
      settings.sound = true; settings.volume = +v('fVolume');
      setTimeout(function () { playAlarmTone(); settings.sound = saved; settings.volume = sv; }, 150);
    });
    $('btnReset').addEventListener('click', function () {
      if (!window.confirm('Скинути всі налаштування та кеш?')) return;
      try { localStorage.removeItem(LS_SETTINGS); localStorage.removeItem(LS_MANUAL); localStorage.removeItem(LS_CACHE); } catch (e) { }
      location.reload();
    });
    window.addEventListener('online', function () { refreshAll(); });
    window.addEventListener('offline', renderStatusBar);

    applyVisibility();
    renderClock();
    if (cache.weather && cache.weatherKey === settings.lat + ',' + settings.lon) {
      renderWeather();
      if (now() - cache.weatherAt > 60 * 60000) $('wMsg').textContent = 'Показано збережені дані від ' + hhmm(new Date(cache.weatherAt)) + ' — оновлюється…';
    } else { cache.weather = null; }
    renderPower(true);
    renderAlert();
    renderStatusBar();
    updateSoundHint();
    applyDim();
    requestWake();

    fetchWeather(); fetchAlerts(); fetchPowerRemote();
    schedule();
    setInterval(tick, 1000);

    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('sw.js').then(null, function () { }); } catch (e) { }
    }
  }

  // Захист від "зависань": неперехоплені помилки не повинні зупиняти годинник
  window.onerror = function () { return true; };

  init();
})();
