/* Web Crawlers — dependency-free DOM / Canvas animation. */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ease = t => t * t * (3 - 2 * t);
  const wrapAngle = value => Math.atan2(Math.sin(value), Math.cos(value));
  const colours = ['#8affec', '#c4a1ff', '#ff80dc', '#b2ff87', '#fff184', '#85b5ff'];
  const effects = ['grab', 'flip', 'invert', 'twist', 'stretch'];
  const styleKeys = ['translate','rotate','scale','transform','transform-origin','color','text-shadow',
    'background-color','box-shadow','border-radius','filter','z-index','position','will-change'];
  const geometryKeys = ['translate','rotate','scale','transform','transform-origin'];
  const ignored = 'script,style,noscript,textarea,input,select,option,button,[contenteditable]:not([contenteditable="false"]),[data-crawl-ignore],[aria-hidden="true"],svg';
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const closest = (point, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return { x:a.x + dx * t, y:a.y + dy * t, t };
  };
  const insideQuad = (point, corners) => {
    let positive = false, negative = false;
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const value = cross({ x:b.x - a.x, y:b.y - a.y }, { x:point.x - a.x, y:point.y - a.y });
      if (value > 0.001) positive = true;
      if (value < -0.001) negative = true;
    }
    return positive !== negative;
  };
  // Segment/quad collision also catches a leg brushing a word, not just landing on it.
  const contactPoint = (a, b, visual, padding = 2.5) => {
    if (Math.max(a.x,b.x) < visual.left-padding || Math.min(a.x,b.x) > visual.right+padding ||
        Math.max(a.y,b.y) < visual.top-padding || Math.min(a.y,b.y) > visual.bottom+padding) return null;
    if (insideQuad(a,visual.corners)) return a;
    if (insideQuad(b,visual.corners)) return b;
    const r = { x:b.x-a.x, y:b.y-a.y };
    for (let i = 0; i < 4; i++) {
      const c = visual.corners[i], d = visual.corners[(i+1)%4];
      const s = { x:d.x-c.x, y:d.y-c.y }, offset = { x:c.x-a.x, y:c.y-a.y };
      const divisor = cross(r,s);
      if (Math.abs(divisor) > 0.0001) {
        const t = cross(offset,s)/divisor, u = cross(offset,r)/divisor;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x:a.x+r.x*t, y:a.y+r.y*t };
      }
      for (const point of [c,d]) { const near = closest(point,a,b); if (length(point,near) <= padding) return near; }
      for (const point of [a,b]) { const near = closest(point,c,d); if (length(point,near) <= padding) return point; }
    }
    return null;
  };

  class WebCrawler {
    constructor(container = document.body, options = {}) {
      this.container = typeof container === 'string' ? document.querySelector(container) : container;
      if (!(this.container instanceof Element)) throw new Error('WebCrawler: 找不到指定的容器。');
      this.options = Object.assign({ selector:null, allText:true, speed:1, size:1, deform:true,
        mode:'auto', effect:'mix', intensity:1.4, maxTargets:1400, respectReducedMotion:true, palette:colours,
        region:null,lazyText:false,injectStyle:true,zIndex:1000 }, options);
      this.options.size = clamp(Number(this.options.size) || 1, 0.35, 2);
      this.options.speed = clamp(Number(this.options.speed) || 1, 0.1, 4);
      this.options.maxTargets = clamp(Math.floor(Number(this.options.maxTargets) || 1400), 1, 5000);
      this.options.intensity = clamp(Number(this.options.intensity) || 1.4, 0.2, 3);
      if (!['mix',...effects].includes(this.options.effect)) this.options.effect = 'mix';
      if (this.options.selector) this.container.querySelectorAll(this.options.selector);
      this.options.palette = Array.isArray(this.options.palette) && this.options.palette.length
        ? this.options.palette : colours;
      if (!['auto','follow'].includes(this.options.mode)) this.options.mode = 'auto';
      this.destroyed = false;
      this.paused = this.options.respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.time = 0;
      this.frames = 0;
      this.stepCount = 0;
      this.lastTimestamp = 0;
      this.lastMeasure = -1;
      this.nextStep = 0;
      this.nextGoal = 0;
      this.lastGroup = 0;
      this.dirty = true;
      this.targets = [];
      this.nodes = new Map();
      this.fragments = new Set();
      this.activeNodes = new Set();
      this.needsTextScan = true;
      this.lastTextScan = -1;
      this.contactCount = 0;
      this.effectCounts = Object.fromEntries(effects.map(effect => [effect,0]));
      this.effectCursor = 0;
      this.particles = [];
      this.legs = [];
      this.trail = [];
      this.pointer = null;
      this.goal = null;
      this.body = { x:0, y:0, vx:0, vy:0, angle:-Math.PI / 2 };

      this.style = document.createElement('style');
      this.style.dataset.webCrawlerStyle = '';
      this.style.textContent = '[data-wc-piece]{display:inline-block;position:relative;vertical-align:baseline;white-space:pre;transform-origin:50% 50%;}';
      if (this.options.injectStyle) document.head.appendChild(this.style);

      // All geometry uses document coordinates. Scrolling moves canvas and text together.
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-hidden', 'true');
      this.canvas.dataset.webCrawler = '';
      Object.assign(this.canvas.style, { position:'fixed', inset:'0', width:'100%', height:'100%',
        pointerEvents:'none', zIndex:String(this.options.zIndex), contain:'strict' });
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) throw new Error('WebCrawler: 浏览器不支持 Canvas 2D。');
      document.body.appendChild(this.canvas);

      this.onResize = () => { this.resize(); this.dirty = true; if (this.paused) { this.measure(); this.draw(); } };
      this.onScroll = () => {
        this.dirty = true;
        if (this.options.lazyText) this.needsTextScan = true;
        if (this.paused) { this.measure(); this.draw(); }
      };
      this.onPointer = event => {
        this.pointer = { x:event.clientX + scrollX, y:event.clientY + scrollY, at:performance.now() };
      };
      this.onVisibility = () => {
        cancelAnimationFrame(this.raf);
        this.lastTimestamp = 0;
        if (!document.hidden && !this.paused) this.raf = requestAnimationFrame(this.tick);
      };
      window.addEventListener('resize', this.onResize, { passive:true });
      window.addEventListener('scroll', this.onScroll, { passive:true, capture:true });
      this.container.addEventListener('pointermove', this.onPointer, { passive:true });
      this.container.addEventListener('pointerdown', this.onPointer, { passive:true });
      document.addEventListener('visibilitychange', this.onVisibility);
      this.resizeObserver = new ResizeObserver(() => { this.dirty = true; });
      this.resizeObserver.observe(this.container);
      this.mutationObserver = new MutationObserver(() => { this.dirty = true; this.needsTextScan = true; });
      this.observeText();

      this.tick = timestamp => {
        if (this.destroyed || this.paused || document.hidden) return;
        // Clamp elapsed time so a slow frame cannot fling the body or its feet.
        const dt = this.lastTimestamp ? clamp((timestamp - this.lastTimestamp) / 1000, 0, 0.035) : 1 / 60;
        this.lastTimestamp = timestamp;
        this.time += dt;
        if (this.dirty || this.time - this.lastMeasure > 0.35) this.measure();
        this.update(dt);
        this.draw();
        this.frames++;
        this.raf = requestAnimationFrame(this.tick);
      };
      this.resize();
      this.measure();
      this.place();
      this.draw();
      if (!this.paused) this.raf = requestAnimationFrame(this.tick);
      if (document.fonts) document.fonts.ready.then(() => { if (!this.destroyed) this.dirty = true; });
    }

    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(innerWidth * this.dpr);
      this.canvas.height = Math.round(innerHeight * this.dpr);
    }

    observeText() {
      this.mutationObserver.observe(this.container, { childList:true, subtree:true, characterData:true });
    }

    prepareText() {
      this.needsTextScan = false;
      this.lastTextScan = this.time;
      if (!this.options.allText) return;
      // Wrap actual text, preserving whitespace, markup, link events and code contents.
      // Observe only application changes: our own wrapping must not feed the observer.
      this.mutationObserver.disconnect();
      try {
        const walker = document.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, {
          acceptNode: text => {
            const parent = text.parentElement;
            if (!parent || !/\S/u.test(text.data) || parent.closest(`${ignored},[data-wc-piece]`)) return NodeFilter.FILTER_REJECT;
            if (this.options.selector && !parent.closest(this.options.selector)) return NodeFilter.FILTER_REJECT;
            if (this.options.region || this.options.lazyText) {
              const range = document.createRange(); range.selectNodeContents(text);
              const region = this.options.region || {x:scrollX,y:scrollY-250,width:innerWidth,height:innerHeight+500};
              const intersects = [...range.getClientRects()].some(rect =>
                rect.right+scrollX>region.x && rect.left+scrollX<region.x+region.width &&
                rect.bottom+scrollY>region.y && rect.top+scrollY<region.y+region.height);
              if (!intersects) return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined,{granularity:'word'}) : null;
        for (const text of texts) {
          const pieces = segmenter ? [...segmenter.segment(text.data)].map(piece => piece.segment)
            : text.data.match(/\s+|[\p{L}\p{N}_]+|[^\s]/gu);
          const replacement = document.createDocumentFragment();
          for (const piece of pieces) {
            if (/^\s+$/u.test(piece)) { replacement.appendChild(document.createTextNode(piece)); continue; }
            // Keep fragments small so a single grip can flip a symbol or a word.
            const characters = Array.from(piece);
            for (let i = 0; i < characters.length; i += 10) {
              const span = document.createElement('span');
              span.dataset.wcPiece = '';
              span.textContent = characters.slice(i,i+10).join('');
              replacement.appendChild(span); this.fragments.add(span);
            }
          }
          text.replaceWith(replacement);
        }
        for (const fragment of this.fragments) if (!fragment.isConnected) this.fragments.delete(fragment);
      } finally { if (!this.destroyed) this.observeText(); }
    }

    remember(element) {
      let node = this.nodes.get(element);
      if (node) return node;
      const original = {};
      for (const key of styleKeys) {
        original[key] = { value:element.style.getPropertyValue(key), priority:element.style.getPropertyPriority(key) };
      }
      const computed = getComputedStyle(element);
      node = { element, original, hadStyle:element.hasAttribute('style'), colour:this.options.palette[this.nodes.size % this.options.palette.length],
        originalEffect:element.getAttribute('data-wc-effect'), baseTransform:computed.transform === 'none' ? '' : computed.transform,
        heat:0, pullX:0, pullY:0, rotation:0, flipX:0, flipY:0, scaleX:1, scaleY:1,
        velocity:{pullX:0,pullY:0,rotation:0,flipX:0,flipY:0,scaleX:0,scaleY:0},
        pivot:null, effect:null, began:-10, lastContact:-10, styled:false, holding:false,
        deform:this.options.deform && computed.display !== 'inline', position:computed.position };
      this.nodes.set(element, node);
      return node;
    }

    restore(node, keys = styleKeys) {
      for (const key of keys) {
        const original = node.original[key];
        if (original.value) node.element.style.setProperty(key, original.value, original.priority);
        else node.element.style.removeProperty(key);
      }
      if (!node.hadStyle && node.element.style.length === 0) node.element.removeAttribute('style');
    }

    measure() {
      if (this.needsTextScan && (this.paused || !this.legs.length || this.time-this.lastTextScan>.25)) this.prepareText();
      this.dirty = false;
      this.lastMeasure = this.time;
      const rect = this.container.getBoundingClientRect();
      this.area = { x:rect.left + scrollX, y:rect.top + scrollY,
        right:rect.right + scrollX, bottom:rect.bottom + scrollY };
      if (this.container === document.body || this.container === document.documentElement) {
        this.area = {x:0,y:0,right:Math.max(innerWidth,document.documentElement.clientWidth),
          bottom:Math.max(innerHeight,document.documentElement.scrollHeight,document.body.scrollHeight)};
      }
      if (this.options.region) {
        const region = this.options.region;
        this.area = {x:Math.max(this.area.x,region.x),y:Math.max(this.area.y,region.y),
          right:Math.min(this.area.right,region.x+region.width),bottom:Math.min(this.area.bottom,region.y+region.height)};
      }
      // Intersect with viewport: only currently visible text can become a foothold.
      this.bounds = { x:Math.max(this.area.x, scrollX) + 18, y:Math.max(this.area.y, scrollY) + 18,
        right:Math.min(this.area.right, scrollX + innerWidth) - 18,
        bottom:Math.min(this.area.bottom, scrollY + innerHeight) - 18 };
      this.visible = this.bounds.right > this.bounds.x && this.bounds.bottom > this.bounds.y;
      for (const [element, node] of this.nodes) {
        if (!element.isConnected || !this.container.contains(element)) {
          this.restore(node); this.restoreEffectAttribute(node); this.activeNodes.delete(node); this.nodes.delete(element);
          for (const leg of this.legs) if (leg.node === node) { leg.node = null; leg.target = null; }
          for (const leg of this.legs) if (leg.to?.node === node) leg.to = {x:leg.foot.x,y:leg.foot.y,node:null};
        } else if (node.styled) this.restore(node, geometryKeys);
      }
      this.targets = [];
      const elements = this.options.allText
        ? this.container.querySelectorAll('[data-wc-piece],img,hr,[data-crawl-object]')
        : this.container.querySelectorAll(this.options.selector || 'a,[data-crawl]');
      for (const element of elements) {
        if (this.targets.length >= this.options.maxTargets) break;
        if (element.closest(ignored) || (this.options.selector && !element.closest(this.options.selector))) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        for (const box of element.getClientRects()) {
          if (box.width < 1 || box.height < 2 || box.right < 0 || box.left > innerWidth || box.bottom < 0 || box.top > innerHeight) continue;
          if (this.options.region && (box.left+scrollX<this.area.x || box.right+scrollX>this.area.right ||
              box.top+scrollY<this.area.y || box.bottom+scrollY>this.area.bottom)) continue;
          const x = Math.max(box.left + scrollX, this.area.x);
          const y = Math.max(box.top + scrollY, this.area.y);
          const right = Math.min(box.right + scrollX, this.area.right);
          const bottom = Math.min(box.bottom + scrollY, this.area.bottom);
          if (right <= x || bottom <= y) continue;
          const node = this.remember(element);
          const target = { x, y, width:right-x, height:bottom-y, node };
          node.box = target;
          if (!node.pivot) node.pivot = { x:target.width/2, y:target.height/2 };
          this.targets.push(target);
          if (this.targets.length >= this.options.maxTargets) break;
        }
      }
      // Keep existing grips attached to the same content after a layout update.
      for (const leg of this.legs) {
        const node = leg.node || leg.to?.node;
        const target = node && this.targets.find(item => item.node === node);
        if (target && leg.node) leg.target = target;
        if (target && leg.to?.node === node) leg.to.target = target;
      }
      for (const node of this.activeNodes) this.applyStyle(node);
      if (this.visible && this.legs.length &&
          (this.body.x < this.bounds.x - 35 || this.body.x > this.bounds.right + 35 ||
           this.body.y < this.bounds.y - 35 || this.body.y > this.bounds.bottom + 35)) this.place();
    }

    constrain(point, padding = 0) {
      const b = this.bounds;
      const px = Math.min(padding, Math.max(0, (b.right - b.x) / 2));
      const py = Math.min(padding, Math.max(0, (b.bottom - b.y) / 2));
      return { x:clamp(point.x, b.x + px, b.right - px), y:clamp(point.y, b.y + py, b.bottom - py) };
    }

    place() {
      if (!this.visible) return;
      const centre = { x:(this.bounds.x + this.bounds.right) / 2, y:(this.bounds.y + this.bounds.bottom) / 2 };
      const target = this.targets.reduce((best, current) => {
        const p = { x:current.x + current.width / 2, y:current.y + current.height / 2 };
        return !best || length(p, centre) < best.distance ? { target:current, distance:length(p, centre) } : best;
      }, null);
      const start = this.constrain(target ? { x:target.target.x + target.target.width / 2,
        y:target.target.y - 26 } : centre, 28);
      Object.assign(this.body, start, { vx:0, vy:0 });
      this.trail = [];
      this.legs = Array.from({ length:8 }, (_, index) => {
        const row = index % 4, side = index < 4 ? -1 : 1;
        const leg = { row, side, group:(row + (side === 1 ? 1 : 0)) % 2,
          upper:(57 + row * 3) * this.options.size, lower:(79 + row * 3) * this.options.size,
          lastStep:-1, stepping:false, node:null, target:null, local:null };
        const anchor = this.findAnchor(leg);
        leg.foot = { x:anchor.x, y:anchor.y }; leg.node = anchor.node;
        leg.target = anchor.target; leg.local = anchor.local;
        return leg;
      });
      this.wander();
    }

    wander() {
      if (this.destroyed || !this.visible) return;
      const candidates = this.targets.filter(target => {
        const p = { x:target.x + target.width / 2, y:target.y };
        const distance = length(p, this.body);
        return distance > 65 * this.options.size && distance < 330 * this.options.size;
      });
      const pool = candidates.length ? candidates : this.targets;
      if (pool.length) {
        const target = pool[Math.floor(Math.random() * pool.length)];
        this.goal = this.constrain({ x:target.x + target.width * (0.25 + Math.random() * 0.5),
          y:target.y + (Math.random() - 0.5) * 60 }, 24);
      } else {
        this.goal = this.constrain({ x:mix(this.bounds.x, this.bounds.right, Math.random()),
          y:mix(this.bounds.y, this.bounds.bottom, Math.random()) }, 24);
      }
      this.nextGoal = this.time + 2 + Math.random() * 2;
    }

    hip(leg) {
      const forward = [10, 4, -3, -10][leg.row] * this.options.size;
      const sideways = leg.side * 5 * this.options.size;
      const c = Math.cos(this.body.angle), s = Math.sin(this.body.angle);
      return { x:this.body.x + c * forward - s * sideways, y:this.body.y + s * forward + c * sideways };
    }

    project(target, local) {
      const node = target.node;
      if (!node.deform) return { x:target.x+local.x, y:target.y+local.y };
      const pivot = node.pivot || { x:target.width/2, y:target.height/2 };
      const x = (local.x-pivot.x)*node.scaleX, y = (local.y-pivot.y)*node.scaleY;
      const rx = node.flipX*Math.PI/180, ry = node.flipY*Math.PI/180, rz = node.rotation*Math.PI/180;
      const x1 = x*Math.cos(ry), z1 = -x*Math.sin(ry);
      const y1 = y*Math.cos(rx)-z1*Math.sin(rx), z2 = y*Math.sin(rx)+z1*Math.cos(rx);
      const perspective = 420/(420-z2);
      return { x:target.x+pivot.x+node.pullX+(x1*Math.cos(rz)-y1*Math.sin(rz))*perspective,
        y:target.y+pivot.y+node.pullY+(x1*Math.sin(rz)+y1*Math.cos(rz))*perspective };
    }

    visual(target) {
      const locals = [{x:0,y:0},{x:target.width,y:0},{x:target.width,y:target.height},{x:0,y:target.height}];
      const corners = locals.map(point => this.project(target,point));
      return { target, locals, corners, left:Math.min(...corners.map(p=>p.x)), right:Math.max(...corners.map(p=>p.x)),
        top:Math.min(...corners.map(p=>p.y)), bottom:Math.max(...corners.map(p=>p.y)) };
    }

    footPoint(leg) {
      return leg.node && leg.target && leg.local ? this.project(leg.target,leg.local) : { ...leg.foot };
    }

    findAnchor(leg) {
      const c = Math.cos(this.body.angle), s = Math.sin(this.body.angle);
      const forward = [82, 37, -32, -78][leg.row] * this.options.size;
      const sideways = [66, 94, 96, 71][leg.row] * leg.side * this.options.size;
      const desired = this.constrain({ x:this.body.x + c * forward - s * sideways + this.body.vx * 0.22,
        y:this.body.y + s * forward + c * sideways + this.body.vy * 0.22 });
      const hip = this.hip(leg);
      const reach = (leg.upper + leg.lower) * 0.95;
      let best = null;
      for (const target of this.targets) {
        // Snap the desired foot to the nearest edge of an actual text rectangle.
        if (Math.abs(target.x+target.width/2-hip.x) > reach+target.width/2+70 ||
            Math.abs(target.y+target.height/2-hip.y) > reach+target.height/2+70) continue;
        const visual = this.visual(target);
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge+1)%4;
          const point = closest(desired,visual.corners[edge],visual.corners[next]);
          if (length(point, hip) > reach || point.x < this.bounds.x - 10 || point.x > this.bounds.right + 10 ||
            point.y < this.bounds.y - 10 || point.y > this.bounds.bottom + 10) continue;
          const lateral = -(point.x - this.body.x) * s + (point.y - this.body.y) * c;
          if (lateral * leg.side < 8 * this.options.size) continue;
          const occupied = this.legs.filter(other => other !== leg && other.node === target.node).length;
          const score = length(point, desired) + occupied * 17;
          if (!best || score < best.score) best = { x:point.x, y:point.y, node:target.node, target, score,
            local:{x:mix(visual.locals[edge].x,visual.locals[next].x,point.t),y:mix(visual.locals[edge].y,visual.locals[next].y,point.t)} };
        }
      }
      if (best) return best;
      const distance = length(desired, hip);
      const factor = Math.min(1, reach / Math.max(1, distance));
      return { x:hip.x + (desired.x - hip.x) * factor, y:hip.y + (desired.y - hip.y) * factor, node:null };
    }

    update(dt) {
      if (!this.visible) return;
      if (!this.legs.length) this.place();
      const speed = this.options.speed;
      let destination = this.goal;
      const pointerActive = this.options.mode === 'follow' && this.pointer && performance.now() - this.pointer.at < 6000;
      if (pointerActive) destination = this.constrain(this.pointer, 20);
      else if (!destination || length(this.body, destination) < 22 || this.time > this.nextGoal) {
        this.wander(); destination = this.goal;
      }
      if (!destination) return;
      destination = this.constrain(destination, 20);
      const dx = destination.x - this.body.x, dy = destination.y - this.body.y;
      const distance = Math.hypot(dx, dy);
      const pace = Math.min(75 * speed * this.options.size, distance * 1.7);
      const damping = 1 - Math.exp(-4 * dt);
      this.body.vx = mix(this.body.vx, distance > 1 ? dx / distance * pace : 0, damping);
      this.body.vy = mix(this.body.vy, distance > 1 ? dy / distance * pace : 0, damping);
      this.body.x += this.body.vx * dt; this.body.y += this.body.vy * dt;
      const bounded = this.constrain(this.body, 15);
      this.body.x = bounded.x; this.body.y = bounded.y;
      if (Math.hypot(this.body.vx, this.body.vy) > 5) {
        this.body.angle += wrapAngle(Math.atan2(this.body.vy, this.body.vx) - this.body.angle) * (1 - Math.exp(-3.5 * dt));
      }

      // Planted feet stay in place. Only feet in the swing phase interpolate to a new grip.
      for (const leg of this.legs) {
        if (!leg.stepping) continue;
        const p = clamp((this.time - leg.started) / leg.duration, 0, 1);
        const t = ease(p), lift = Math.sin(p * Math.PI) * 10 * this.options.size;
        const to = leg.to.node && leg.to.target ? this.project(leg.to.target,leg.to.local) : leg.to;
        const angle = Math.atan2(to.y - leg.from.y, to.x - leg.from.x);
        leg.foot.x = mix(leg.from.x, to.x, t) - Math.sin(angle) * lift;
        leg.foot.y = mix(leg.from.y, to.y, t) + Math.cos(angle) * lift;
        if (p >= 1) {
          leg.stepping = false; leg.node = leg.to.node; leg.target = leg.to.target;
          leg.local = leg.to.local; leg.lastStep = this.time;
        }
      }
      if (this.time >= this.nextStep && this.legs.filter(leg => leg.stepping).length < 4) {
        let candidate = null;
        for (const leg of this.legs) {
          if (leg.stepping || this.time - leg.lastStep < 0.2 / speed) continue;
          const anchor = this.findAnchor(leg);
          const foot = this.footPoint(leg);
          const error = length(anchor, foot);
          const reachRatio = length(this.hip(leg), foot) / (leg.upper + leg.lower);
          const score = error + (reachRatio > 0.88 ? 100 : 0) + (leg.group !== this.lastGroup ? 15 : 0);
          if ((error > 23 * this.options.size || reachRatio > 0.9) && (!candidate || score > candidate.score)) {
            candidate = { leg, anchor, score };
          }
        }
        if (candidate) {
          const { leg, anchor } = candidate;
          leg.from = this.footPoint(leg); leg.to = anchor; leg.node = null; leg.target = null;
          leg.started = this.time; leg.duration = 0.24 / Math.sqrt(speed); leg.stepping = true;
          this.lastGroup = leg.group; this.nextStep = this.time + 0.075 / speed; this.stepCount++;
        }
      }

      this.detectContacts();
      this.updateEffects(dt);
      for (const particle of this.particles) {
        particle.x += particle.vx*dt; particle.y += particle.vy*dt; particle.vy += 30*dt; particle.life -= dt;
      }
      this.particles = this.particles.filter(particle => particle.life > 0);
      if (!this.trail.length || this.time - this.trail[this.trail.length - 1].at > 0.055) {
        this.trail.push({ ...this.body, at:this.time });
        if (this.trail.length > 7) this.trail.shift();
      }
    }

    detectContacts() {
      const visuals = this.targets.map(target => this.visual(target));
      const hits = new Map();
      const add = (target,point,kind,leg) => {
        const previous = hits.get(target.node);
        if (!previous || kind === 'foot') hits.set(target.node,{target,point,kind,leg});
      };
      for (const leg of this.legs) {
        const hip = this.hip(leg), foot = this.footPoint(leg), knee = this.knee(hip,foot,leg);
        if (leg.node && leg.target && !leg.stepping) add(leg.target,foot,'foot',leg);
        for (const visual of visuals) {
          const hit = contactPoint(hip,knee,visual) || contactPoint(knee,foot,visual);
          if (hit) add(visual.target,hit,'leg',leg);
        }
      }
      for (const hit of hits.values()) this.touch(hit);
    }

    touch(hit) {
      const node = hit.target.node;
      node.lastContact = this.time;
      node.kind = hit.kind;
      node.holding = true;
      if (this.activeNodes.has(node)) return;
      node.effect = this.options.effect === 'mix' ? effects[this.effectCursor++ % effects.length] : this.options.effect;
      node.began = this.time;
      node.direction = this.contactCount % 2 ? -1 : 1;
      node.flipAxis = this.contactCount % 2 ? 'flipX' : 'flipY';
      // A planted toe becomes the hinge. A brushing leg uses the contact point.
      node.pivot = hit.kind === 'foot' && hit.leg.local ? { ...hit.leg.local }
        : { x:clamp(hit.point.x-hit.target.x,0,hit.target.width),y:clamp(hit.point.y-hit.target.y,0,hit.target.height) };
      node.element.setAttribute('data-wc-effect',node.effect);
      this.activeNodes.add(node);
      this.contactCount++; this.effectCounts[node.effect]++;
      for (let i=0;i<3 && this.particles.length<180;i++) this.particles.push({ x:hit.point.x,y:hit.point.y,
        vx:(Math.random()-.5)*60,vy:(Math.random()-.5)*60,life:.35+Math.random()*.25,colour:node.colour });
      this.container.dispatchEvent(new CustomEvent('crawlercontact',{detail:{
        element:node.element,effect:node.effect,kind:hit.kind,point:{...hit.point}
      }}));
    }

    updateEffects(dt) {
      for (const node of this.activeNodes) {
        const age = this.time-node.began;
        node.holding = this.time-node.lastContact < .09;
        const held = node.holding || age < (node.effect === 'flip' ? .65 : .32);
        const strength = this.options.intensity * (node.kind === 'foot' ? 1 : .78);
        const desired = {pullX:0,pullY:0,rotation:0,flipX:0,flipY:0,scaleX:1,scaleY:1};
        const phase = ease(clamp(age/.22,0,1));
        if (held && node.box) {
          const dx = clamp(this.body.x-(node.box.x+node.box.width/2),-120,120);
          const dy = clamp(this.body.y-(node.box.y+node.box.height/2),-100,100);
          if (node.effect === 'grab') {
            desired.pullX = dx*.24*strength*phase;
            desired.pullY = (dy*.17-17)*strength*phase;
            desired.rotation = node.direction*12*strength;
            desired.scaleX = desired.scaleY = 1+.14*strength;
          } else if (node.effect === 'flip') {
            desired[node.flipAxis] = node.direction*180*ease(clamp(age/.38,0,1));
            desired.pullY = -5*strength; desired.rotation = node.direction*5*strength;
          } else if (node.effect === 'twist') {
            desired.rotation = (node.direction*22+Math.sin(age*7)*12)*strength;
            desired.flipX = Math.sin(age*4)*22;
            desired.pullY = -8*strength;
          } else if (node.effect === 'stretch') {
            desired.scaleX = 1+.6*strength;
            desired.scaleY = Math.max(.38,1-.25*strength);
            desired.pullX = node.direction*8*strength; desired.rotation = node.direction*4;
          } else {
            desired.pullY = -3*strength;
            desired.scaleX = desired.scaleY = 1+.08*strength;
          }
        }
        node.heat = mix(node.heat,held ? 1 : 0,1-Math.exp(-dt*(held ? 12 : 5)));
        // Spring back instead of abruptly resetting the content when the leg lets go.
        let moving = 0;
        for (const key of Object.keys(desired)) {
          const stiffness = held ? 95 : 120, damping = held ? 18 : 13;
          node.velocity[key] += ((desired[key]-node[key])*stiffness-node.velocity[key]*damping)*dt;
          node[key] += node.velocity[key]*dt;
          moving += Math.abs(desired[key]-node[key])+Math.abs(node.velocity[key])*.05;
        }
        if (node.box && node.deform) {
          const visual = this.visual(node.box);
          if (visual.left < this.area.x+1) { node.pullX += this.area.x+1-visual.left; node.velocity.pullX = 0; }
          else if (visual.right > this.area.right-1) { node.pullX -= visual.right-this.area.right+1; node.velocity.pullX = 0; }
          if (this.options.region) {
            if (visual.top<this.area.y+1) {node.pullY+=this.area.y+1-visual.top;node.velocity.pullY=0;}
            else if (visual.bottom>this.area.bottom-1) {node.pullY-=visual.bottom-this.area.bottom+1;node.velocity.pullY=0;}
          }
        }
        if (!held && node.heat < .008 && moving < .05) {
          this.restore(node); this.restoreEffectAttribute(node); node.styled = false;
          Object.assign(node,{heat:0,pullX:0,pullY:0,rotation:0,flipX:0,flipY:0,scaleX:1,scaleY:1});
          this.activeNodes.delete(node);
        } else this.applyStyle(node);
      }
    }

    restoreEffectAttribute(node) {
      if (node.originalEffect === null) node.element.removeAttribute('data-wc-effect');
      else node.element.setAttribute('data-wc-effect',node.originalEffect);
    }

    applyStyle(node) {
      if (!this.activeNodes.has(node)) return;
      node.styled = true;
      const style = node.element.style, heat = node.heat;
      if (node.deform) {
        style.setProperty('translate',`${node.pullX.toFixed(2)}px ${node.pullY.toFixed(2)}px`);
        style.setProperty('transform-origin',`${node.pivot.x.toFixed(2)}px ${node.pivot.y.toFixed(2)}px`);
        style.setProperty('transform',`${node.baseTransform} perspective(420px) rotateZ(${node.rotation.toFixed(2)}deg) rotateX(${node.flipX.toFixed(2)}deg) rotateY(${node.flipY.toFixed(2)}deg) scale(${node.scaleX.toFixed(3)},${node.scaleY.toFixed(3)})`);
        style.setProperty('will-change','transform');
      }
      style.setProperty('text-shadow',`0 0 ${(heat*10).toFixed(1)}px ${node.colour}`);
      style.setProperty('color',node.effect === 'invert' && heat>.4 ? '#07130f' : node.colour);
      style.setProperty('background-color',node.effect === 'invert' && heat>.4 ? node.colour : 'transparent');
      style.setProperty('box-shadow',`0 0 ${(heat*9).toFixed(1)}px ${node.colour}55`);
      style.setProperty('border-radius','1px');
      if (node.position === 'static') style.setProperty('position','relative');
      style.setProperty('z-index','2');
    }

    // Two-bone inverse kinematics: the law of cosines gives a stable knee position.
    knee(hip, foot, leg) {
      const dx = foot.x - hip.x, dy = foot.y - hip.y;
      const distance = clamp(Math.hypot(dx, dy), 0.01, leg.upper + leg.lower - 0.01);
      const angle = Math.atan2(dy, dx);
      const bend = Math.acos(clamp((leg.upper ** 2 + distance ** 2 - leg.lower ** 2) / (2 * leg.upper * distance), -1, 1));
      const sign = leg.side * (leg.row < 2 ? 1 : -1);
      return { x:hip.x + Math.cos(angle + bend * sign) * leg.upper,
        y:hip.y + Math.sin(angle + bend * sign) * leg.upper };
    }

    draw() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (!this.visible || !this.legs.length) return;
      ctx.save(); ctx.translate(-scrollX, -scrollY);
      ctx.beginPath(); ctx.rect(this.area.x, this.area.y, this.area.right - this.area.x, this.area.bottom - this.area.y); ctx.clip();

      // Text rectangles glow where the legs grip; the overlay never intercepts clicks.
      for (const target of this.targets) {
        const node = target.node, heat = node.heat;
        if (heat < 0.03) continue;
        const visual = this.visual(target);
        ctx.save();
        ctx.shadowColor = node.colour; ctx.shadowBlur = 12 * heat;
        ctx.globalAlpha = heat * (node.effect === 'invert' ? .05 : .18); ctx.fillStyle = node.colour;
        ctx.beginPath(); visual.corners.forEach((point,index) => index ? ctx.lineTo(point.x,point.y) : ctx.moveTo(point.x,point.y));
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = heat * .8; ctx.lineWidth = .8; ctx.strokeStyle = node.colour; ctx.stroke();
        ctx.globalAlpha = heat;
        const marker = visual.corners[1];
        ctx.fillRect(marker.x-1.5,marker.y-1.5,3,3);
        ctx.restore();
      }
      for (const particle of this.particles) {
        ctx.globalAlpha = Math.min(1,particle.life*2); ctx.fillStyle = particle.colour;
        ctx.fillRect(particle.x,particle.y,1.5,1.5);
      }
      for (const ghost of this.trail) {
        ctx.globalAlpha = Math.max(0, 0.09 - (this.time - ghost.at) * 0.25);
        ctx.strokeStyle = '#a2ffe9'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.arc(ghost.x, ghost.y, 5 * this.options.size, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let index = 0; index < this.legs.length; index++) {
        const leg = this.legs[index], hip = this.hip(leg);
        const foot = this.footPoint(leg);
        const knee = this.knee(hip, foot, leg);
        const colour = leg.node?.colour || this.options.palette[index % this.options.palette.length];
        ctx.strokeStyle = colour; ctx.shadowColor = colour; ctx.shadowBlur = 9;
        ctx.lineWidth = 1.1 * this.options.size;
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(knee.x, knee.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
        ctx.shadowBlur = 0; ctx.globalAlpha = 0.78; ctx.strokeStyle = '#ecfff9'; ctx.lineWidth = 0.45 * this.options.size; ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(knee.x, knee.y, 1.2 * this.options.size, 0, TAU); ctx.fill();
        ctx.strokeStyle = colour; ctx.lineWidth = 0.8;
        ctx.save(); ctx.translate(foot.x,foot.y); ctx.rotate(Math.atan2(foot.y-knee.y,foot.x-knee.x));
        const opening = leg.node && !leg.stepping ? 2.5 : 4.5;
        ctx.beginPath(); ctx.moveTo(-4,-opening); ctx.lineTo(2,-opening); ctx.lineTo(3,0);
        ctx.moveTo(-4,opening); ctx.lineTo(2,opening); ctx.lineTo(3,0); ctx.stroke(); ctx.restore();
        if (leg.stepping) {
          ctx.globalAlpha = 0.14; ctx.setLineDash([2, 5]);
          const to = leg.to.node && leg.to.target ? this.project(leg.to.target,leg.to.local) : leg.to;
          ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(to.x, to.y); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
      }
      ctx.save(); ctx.translate(this.body.x, this.body.y); ctx.rotate(this.body.angle);
      const size = this.options.size;
      ctx.scale(size, size);
      ctx.shadowColor = '#afffea'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#0a171b'; ctx.strokeStyle = '#9efbe8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(-5, 0, 10, 5.3 + Math.sin(this.time * 4) * 0.3, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c6a0ff';
      ctx.beginPath(); ctx.ellipse(8, 0, 5, 4, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#dcfff4'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(11, 0); ctx.stroke();
      ctx.fillStyle = '#fff5bb'; ctx.shadowColor = '#fff5bb'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(10, -2, 1.1, 0, TAU); ctx.arc(10, 2, 1.1, 0, TAU); ctx.fill();
      ctx.restore(); ctx.restore();
    }

    pause() { if (this.destroyed) return; this.paused = true; cancelAnimationFrame(this.raf); }
    resume() {
      if (this.destroyed || !this.paused) return;
      this.paused = false; this.lastTimestamp = 0;
      if (!document.hidden) this.raf = requestAnimationFrame(this.tick);
    }
    toggle() { this.paused ? this.resume() : this.pause(); }
    setSpeed(value) {
      if (!Number.isFinite(Number(value))) throw new Error('WebCrawler: speed 必须是数值。');
      this.options.speed = clamp(Number(value), 0.1, 4);
    }
    setMode(mode) {
      if (!['auto','follow'].includes(mode)) throw new Error('WebCrawler: mode 只能是 auto 或 follow。');
      this.options.mode = mode;
      if (mode === 'auto') this.wander();
    }
    setEffect(effect) {
      if (!['mix',...effects].includes(effect)) throw new Error('WebCrawler: 未知的接触效果。');
      this.options.effect = effect;
      // Existing grips change too; do not make users wait for a new contact.
      for (const node of this.activeNodes) {
        node.effect = effect === 'mix' ? effects[this.effectCursor++ % effects.length] : effect;
        node.began = this.time;
        node.element.setAttribute('data-wc-effect',node.effect);
      }
    }
    setIntensity(value) {
      if (!Number.isFinite(Number(value))) throw new Error('WebCrawler: intensity 必须是数值。');
      this.options.intensity = clamp(Number(value),.2,3);
    }
    refresh() { if (!this.destroyed) { this.measure(); this.draw(); } }
    getState() {
      return { paused:this.paused, mode:this.options.mode, speed:this.options.speed,
        targetCount:this.targets.length, attachedLegs:this.legs.filter(leg => leg.node && !leg.stepping).length,
        contacts:this.contactCount,activeEffects:this.activeNodes.size,effect:this.options.effect,
        intensity:this.options.intensity,effectCounts:{...this.effectCounts},
        position:{ x:this.body.x, y:this.body.y }, frames:this.frames, steps:this.stepCount, destroyed:this.destroyed };
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true; this.paused = true; cancelAnimationFrame(this.raf);
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('scroll', this.onScroll, true);
      this.container.removeEventListener('pointermove', this.onPointer);
      this.container.removeEventListener('pointerdown', this.onPointer);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.resizeObserver.disconnect(); this.mutationObserver.disconnect();
      for (const node of this.nodes.values()) { this.restore(node); this.restoreEffectAttribute(node); }
      // Unwrap our spans without rebuilding their parents or losing original event listeners.
      for (const fragment of this.fragments) if (fragment.parentNode) fragment.replaceWith(...fragment.childNodes);
      this.fragments.clear(); this.activeNodes.clear(); this.nodes.clear();
      this.style.remove(); this.canvas.remove();
    }
  }

  global.WebCrawler = WebCrawler;
})(window);
