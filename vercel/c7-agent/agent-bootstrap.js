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
    function forget(target, type, listener, capture) {
      for (const item of listeners) {
        if (item.active && item.target === target && item.type === type &&
            item.listener === listener && item.capture === capture) item.active = false;
      }
    }
    function remember(target, type, listener, options) {
      if (type !== "keydown" && type !== "keyup") return;
      if (!(typeof listener === "function" || (listener && typeof listener.handleEvent === "function"))) return;
      const o = optionsOf(options);
      if (o.signal?.aborted) return;
      if (listeners.some(x => x.active && x.target === target && x.type === type &&
          x.listener === listener && x.capture === o.capture)) return;
      const item = { target, type, listener, capture:o.capture, once:o.once, passive:o.passive, signal:o.signal, active:true };
      listeners.push(item);
      if (o.signal) {
        try { o.signal.addEventListener("abort", () => forget(target, type, listener, o.capture), { once:true }); } catch {}
      }
    }

    try {
      Object.defineProperty(proto, "addEventListener", {
        configurable:true, writable:true,
        value:function(type, listener, options) {
          const result = Reflect.apply(nativeAdd, this, [type, listener, options]);
          remember(this, String(type), listener, options);
          return result;
        }
      });
      if (typeof nativeRemove === "function") {
        Object.defineProperty(proto, "removeEventListener", {
          configurable:true, writable:true,
          value:function(type, listener, options) {
            const result = Reflect.apply(nativeRemove, this, [type, listener, options]);
            if (type === "keydown" || type === "keyup") forget(this, String(type), listener, optionsOf(options).capture);
            return result;
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
      return { key:value.toLowerCase(), code:"Key"+upper, keyCode:upper.charCodeAt(0) };
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
    function invokeProperty(target, type, event, counts) {
      try {
        const fn = target && target["on"+type];
        if (typeof fn === "function") {
          Reflect.apply(fn, target, [event]);
          counts.delivered++;
        }
      } catch (error) {
        counts.errors++;
        counts.firstError ||= String(error?.message || error).slice(0,160);
      }
    }
    function send(key, type, target) {
      if (type !== "keydown" && type !== "keyup") return { ok:false, delivered:0, error:"Unsupported event type." };
      if (!target || !target.nodeType) return { ok:false, delivered:0, error:"No game canvas target." };

      const info = keyInfo(key);
      const path = buildPath(target);
      const event = new win.KeyboardEvent(type, {
        key:info.key, code:info.code, keyCode:info.keyCode, which:info.keyCode,
        bubbles:true, cancelable:true, composed:true, view:win
      });
      const flags = { stopped:false, immediate:false, passive:false };
      const counts = { delivered:0, errors:0, firstError:null };
      let currentTarget = null, phase = 0;
      const preventDefault = event.preventDefault.bind(event);
      const nativeStopPropagation = event.stopPropagation.bind(event);
      const nativeStopImmediatePropagation = event.stopImmediatePropagation.bind(event);
      Object.defineProperties(event, {
        target:{ configurable:true, get:()=>target },
        srcElement:{ configurable:true, get:()=>target },
        currentTarget:{ configurable:true, get:()=>currentTarget },
        eventPhase:{ configurable:true, get:()=>phase },
        composedPath:{ configurable:true, value:()=>path.slice() },
        preventDefault:{ configurable:true, value:function(){ if(!flags.passive) preventDefault(); } },
        stopPropagation:{ configurable:true, value:function(){ flags.stopped=true; nativeStopPropagation(); } },
        stopImmediatePropagation:{ configurable:true, value:function(){ flags.stopped=true; flags.immediate=true; nativeStopImmediatePropagation(); } }
      });

      function invokeAt(node, capture, eventPhase) {
        currentTarget = node;
        phase = eventPhase;
        flags.immediate = false;
        const matching = listeners.filter(x => x.active && !x.signal?.aborted &&
          x.type === type && x.target === node && x.capture === capture);
        for (const item of matching) {
          if (flags.immediate) break;
          flags.passive = item.passive;
          try {
            if (typeof item.listener === "function") Reflect.apply(item.listener, node, [event]);
            else Reflect.apply(item.listener.handleEvent, item.listener, [event]);
            counts.delivered++;
          } catch (error) {
            counts.errors++;
            counts.firstError ||= String(error?.message || error).slice(0,160);
          } finally { flags.passive = false; }
          if (item.once) {
            try { Reflect.apply(nativeRemove, node, [type, item.listener, item.capture]); } catch {}
            item.active = false;
          }
        }
        if (!capture && !flags.immediate) invokeProperty(node, type, event, counts);
      }

      for (const node of path.slice().reverse()) {
        invokeAt(node, true, node === target ? 2 : 1);
        if (flags.stopped && node !== target) break;
      }
      if (!flags.stopped || path[0] === target) {
        if (!flags.immediate) invokeAt(target, false, 2);
        if (event.bubbles && !flags.stopped) {
          for (const node of path.slice(1)) {
            invokeAt(node, false, 3);
            if (flags.stopped) break;
          }
        }
      }
      currentTarget = null;
      phase = 0;
      return {
        ok:counts.delivered > 0,
        delivered:counts.delivered,
        errors:counts.errors,
        firstError:counts.firstError,
        defaultPrevented:event.defaultPrevented,
        trusted:event.isTrusted,
        key:info.key,
        type
      };
    }

    const agent = Object.freeze({
      version:VERSION,
      status() {
        const down = listeners.filter(x => x.active && x.type === "keydown").length;
        const up = listeners.filter(x => x.active && x.type === "keyup").length;
        const doc = win.document;
        const canvases = Array.from(doc.querySelectorAll("canvas"));
        canvases.sort((a,b) => {
          const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
          return rb.width*rb.height-ra.width*ra.height;
        });
        const targets = new Set([win,doc,doc.documentElement,doc.body]);
        if (canvases[0]) for (const target of buildPath(canvases[0])) targets.add(target);
        const propertyKeydown = Array.from(targets).filter(x=>typeof x?.onkeydown==="function").length;
        const propertyKeyup = Array.from(targets).filter(x=>typeof x?.onkeyup==="function").length;
        return {
          ready:true, version:VERSION,
          keydownCount:down+propertyKeydown,
          keyupCount:up+propertyKeyup,
          registeredKeydown:down, registeredKeyup:up,
          propertyKeydown, propertyKeyup
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