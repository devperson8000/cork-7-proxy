(function () {
  "use strict";
  const VERSION = "cork7-browser-agent-1";
  const HOSTS = new Set(["cork7.com", "www.cork7.com", "live.cork7.com"]);
  const KEY = "__CORK7_AGENT__";

  function isCork7(win) {
    try { return HOSTS.has(new URL(win.location.href).hostname.toLowerCase()); }
    catch { return false; }
  }

  function installAgent(win) {
    if (win[KEY]) return win[KEY];
    const proto = win.EventTarget && win.EventTarget.prototype;
    if (!proto || typeof proto.addEventListener !== "function") return null;

    const nativeAdd = proto.addEventListener;
    const nativeRemove = proto.removeEventListener;
    const listeners = [];

    function optionsOf(value) {
      return typeof value === "boolean"
        ? { capture: value, once: false, passive: false, signal: null }
        : { capture: !!value?.capture, once: !!value?.once, passive: !!value?.passive, signal: value?.signal || null };
    }
    function isDiagnostic(listener) {
      try {
        return listener?.__CORK7_DIAGNOSTIC__ === true ||
          listener?.handleEvent?.__CORK7_DIAGNOSTIC__ === true;
      } catch { return false; }
    }
    function validListener(listener) {
      return typeof listener === "function" || (listener && typeof listener.handleEvent === "function");
    }
    function addTracked(target, type, listener, options) {
      const o = optionsOf(options);
      if (o.signal?.aborted) return Reflect.apply(nativeAdd, target, [type, listener, options]);
      const existing = listeners.find(x => x.active && x.target === target && x.type === type &&
        x.listener === listener && x.capture === o.capture);
      // The DOM ignores duplicate listener/capture pairs, even when options differ.
      if (existing) return;
      const item = {
        target, type, listener, capture:o.capture, once:o.once,
        passive:o.passive, signal:o.signal, active:true, wrapped:null
      };
      item.wrapped = function(event) {
        if (item.once) item.active = false;
        if (typeof listener === "function") return Reflect.apply(listener, this, [event]);
        return Reflect.apply(listener.handleEvent, listener, [event]);
      };
      const nativeOptions = typeof options === "boolean" ? options : options && typeof options === "object"
        ? { capture:o.capture, once:o.once, passive:o.passive, ...(o.signal ? { signal:o.signal } : {}) }
        : options;
      Reflect.apply(nativeAdd, target, [type, item.wrapped, nativeOptions]);
      listeners.push(item);
      if (o.signal) {
        try { o.signal.addEventListener("abort", () => { item.active = false; }, { once:true }); } catch {}
      }
    }

    try {
      Object.defineProperty(proto, "addEventListener", {
        configurable:true, writable:true,
        value:function(type, listener, options) {
          const normalizedType = String(type);
          if ((normalizedType === "keydown" || normalizedType === "keyup") && validListener(listener) && !isDiagnostic(listener)) {
            return addTracked(this, normalizedType, listener, options);
          }
          return Reflect.apply(nativeAdd, this, [type, listener, options]);
        }
      });
      if (typeof nativeRemove === "function") {
        Object.defineProperty(proto, "removeEventListener", {
          configurable:true, writable:true,
          value:function(type, listener, options) {
            const normalizedType = String(type);
            if (normalizedType === "keydown" || normalizedType === "keyup") {
              const capture = optionsOf(options).capture;
              const item = listeners.find(x => x.active && x.target === this && x.type === normalizedType &&
                x.listener === listener && x.capture === capture);
              if (item) {
                item.active = false;
                return Reflect.apply(nativeRemove, this, [type, item.wrapped, capture]);
              }
            }
            return Reflect.apply(nativeRemove, this, [type, listener, options]);
          }
        });
      }
    } catch { return null; }

    function keyInfo(key) {
      const value = String(key);
      const special = {
        Space:[" ","Space",32], Shift:["Shift","ShiftLeft",16],
        ArrowLeft:["ArrowLeft","ArrowLeft",37], ArrowUp:["ArrowUp","ArrowUp",38],
        ArrowRight:["ArrowRight","ArrowRight",39], ArrowDown:["ArrowDown","ArrowDown",40],
        Escape:["Escape","Escape",27]
      };
      if (special[value]) return { key:special[value][0], code:special[value][1], keyCode:special[value][2] };
      const upper = value.toUpperCase();
      return { key:value.length === 1 ? value.toLowerCase() : value, code:value.length === 1 ? "Key"+upper : value, keyCode:upper.charCodeAt(0) };
    }
    function buildPath(target) {
      const path = [];
      let node = target;
      while (node && !path.includes(node)) {
        path.push(node);
        if (node === win.document) break;
        node = node.parentNode || node.host || null;
      }
      if (!path.includes(win.document)) path.push(win.document);
      path.push(win);
      return path;
    }
    function pathCounts(path) {
      const onPath = item => item.active && !item.signal?.aborted && path.includes(item.target);
      const propertyCount = type => path.reduce((count,target)=>
        count + (typeof target?.["on"+type] === "function" ? 1 : 0),0);
      const keydown = listeners.filter(item=>item.type === "keydown" && onPath(item)).length + propertyCount("keydown");
      const keyup = listeners.filter(item=>item.type === "keyup" && onPath(item)).length + propertyCount("keyup");
      return { keydown, keyup };
    }
    function send(key, type, target) {
      if (type !== "keydown" && type !== "keyup") return { ok:false, delivered:0, error:"Unsupported event type." };
      if (!target || typeof target.dispatchEvent !== "function") return { ok:false, delivered:0, error:"No game canvas target." };
      const path = buildPath(target);
      const counts = pathCounts(path);
      const relevant = counts[type === "keydown" ? "keydown" : "keyup"];
      if (!relevant) return { ok:false, delivered:0, error:"No matching game input listeners are registered on the canvas event path." };
      const info = keyInfo(key);
      let event;
      let reachedTarget = false;
      const targetAudit = () => { reachedTarget = true; };
      try {
        event = new win.KeyboardEvent(type, {
          key:info.key, code:info.code, keyCode:info.keyCode, which:info.keyCode,
          bubbles:true, cancelable:true, composed:true, view:win
        });
        // Observe whether native propagation actually reaches the canvas.
        // Register outside the tracked list so this audit cannot unlock controls.
        Reflect.apply(nativeAdd, target, [type, targetAudit, true]);
        // Use the browser's own EventTarget dispatch algorithm. This preserves
        // real capture/bubble ordering, currentTarget, once, AbortSignal,
        // passive listeners, propagation and preventDefault semantics.
        target.dispatchEvent(event);
      } catch (error) {
        return { ok:false, registeredOnPath:0, error:String(error?.message || error).slice(0,180), trusted:false };
      } finally {
        try { Reflect.apply(nativeRemove, target, [type, targetAudit, true]); } catch {}
      }
      if (!reachedTarget) return {
        ok:false, registeredOnPath:relevant,
        error:"The keyboard event was stopped before reaching the game canvas.",
        trusted:event.isTrusted, defaultPrevented:event.defaultPrevented
      };
      // Registered handlers and canvas arrival do not prove that the game
      // acted on an untrusted event; a visible game-state change must confirm it.
      return {
        ok:true, registeredOnPath:relevant, reachedTarget:true,
        defaultPrevented:event.defaultPrevented, trusted:event.isTrusted,
        key:info.key, type, targetTag:String(target.tagName || "" ).toLowerCase()
      };
    }

    const agent = Object.freeze({
      version:VERSION,
      status() {
        const doc = win.document;
        const canvases = Array.from(doc.querySelectorAll("canvas"));
        canvases.sort((a,b) => {
          const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
          return rb.width*rb.height-ra.width*ra.height;
        });
        const canvas = canvases[0] || null;
        const path = canvas ? buildPath(canvas) : [];
        const counts = pathCounts(path);
        const visibleCanvas = !!canvas && (()=>{ const r=canvas.getBoundingClientRect(); return r.width>32 && r.height>32; })();
        return {
          ready:true, version:VERSION,
          canvasFound:!!canvas, visibleCanvas,
          keydownCount:counts.keydown, keyupCount:counts.keyup,
          registeredKeydown:counts.keydown, registeredKeyup:counts.keyup,
          canSend:visibleCanvas && counts.keydown>0 && counts.keyup>0,
          trustedHardwareEvents:false,
          targetPath:path.map(node=>node===win?"window":node===doc?"document":String(node.nodeName||"node").toLowerCase())
        };
      },
      send
    });
    try {
      Object.defineProperty(win, KEY, { configurable:false, enumerable:false, writable:false, value:agent });
      return agent;
    } catch { return null; }
  }

  function installControllerHook() {
    const api = window.$scramjetController;
    if (!api?.Controller || !api?.ManagedPlugin) return false;
    const Controller = api.Controller;
    if (Controller.prototype.__cork7AgentHookInstalled) return true;

    class Cork7InputPlugin extends api.ManagedPlugin {
      constructor() { super("cork7-input-agent", []); }
      install(frame) {
        super.install(frame);
        this.tap(frame.hooks.init.post, context => {
          if (!context?.isTopLevel || !context.window) return;
          if (!isCork7(context.window)) {
            window.__CORK7_AGENT_BOOT_STATUS__ = {
              ready:false,
              reason:"The proxied frame did not resolve to the Cork7 website."
            };
            return;
          }
          const result = installAgent(context.window);
          window.__CORK7_AGENT_BOOT_STATUS__ = result
            ? { ready:true, version:VERSION, page:"Cork7" }
            : { ready:false, reason:"The early game input listener hook could not be installed." };
        });
      }
    }

    const original = Controller.prototype.createFrame;
    Object.defineProperty(Controller.prototype, "createFrame", {
      configurable:true, writable:true,
      value:function(element, options) {
        const current = options && typeof options === "object" ? options : {};
        const plugins = Array.isArray(current.plugins) ? current.plugins.slice() : [];
        if (!plugins.some(plugin => plugin?.name === "cork7-input-agent")) plugins.push(new Cork7InputPlugin());
        return Reflect.apply(original, this, [element, { ...current, plugins }]);
      }
    });
    Object.defineProperty(Controller.prototype, "__cork7AgentHookInstalled", { value:true });
    window.__CORK7_AGENT_BOOT_STATUS__ = { ready:true, version:VERSION, page:"player", hook:"installed" };
    return true;
  }

  try {
    if (!installControllerHook()) {
      window.__CORK7_AGENT_BOOT_STATUS__ = {
        ready:false, reason:"Scramjet controller API was not ready before the player module."
      };
    }
  } catch (error) {
    window.__CORK7_AGENT_BOOT_STATUS__ = {
      ready:false, reason:String(error?.message || error).slice(0,180)
    };
  }
})();