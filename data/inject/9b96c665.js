// NeoPass - Tab Switch Bypass (Lightweight)
// Forces all bypass flags to true without heavy polling.

(function () {
  var port;
  try {
    port = document.getElementById('lwys-ctv-port');
    port.remove();
  }
  catch (e) {
    port = document.createElement('span');
    port.id = 'lwys-ctv-port';
    document.documentElement.append(port);
  }

  // Set all bypass flags on the DOM element
  port.dataset.hidden = false;
  port.dataset.enabled = true;
  port.dataset.blur = true;
  port.dataset.focus = true;
  port.dataset.mouseleave = true;
  port.dataset.visibility = true;
  port.dataset.pointercapture = true;

  // Force visibility to never show as hidden
  port.addEventListener('state', () => {
    port.dataset.hidden = false;
  });

  // Force storage flags once on load
  chrome.storage.local.set({
    'enabled': true,
    'blur': true,
    'focus': true,
    'mouseleave': true,
    'visibility': true,
    'pointercapture': true
  });

  // Only react to storage changes (no polling)
  chrome.storage.onChanged.addListener((changes) => {
    const keys = ['enabled', 'blur', 'focus', 'mouseleave', 'visibility', 'pointercapture'];
    let needsReset = false;
    for (const key of keys) {
      if (changes[key] && changes[key].newValue !== true) {
        needsReset = true;
        break;
      }
    }
    if (needsReset) {
      chrome.storage.local.set({
        'enabled': true,
        'blur': true,
        'focus': true,
        'mouseleave': true,
        'visibility': true,
        'pointercapture': true
      });
    }
    // Re-apply DOM flags
    port.dataset.enabled = true;
    port.dataset.blur = true;
    port.dataset.focus = true;
    port.dataset.mouseleave = true;
    port.dataset.visibility = true;
    port.dataset.pointercapture = true;
    port.dataset.hidden = false;
  });

})();