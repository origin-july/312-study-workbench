/* webapp 正式版冒烟测试：单遍同步执行，结果写进 document.title */
(function () {
  var R = [];
  function ok(n, c) { R.push((c ? 'PASS ' : 'FAIL ') + n); }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function nav(scr) { qa('nav.top button').filter(function (b) { return b.dataset.scr === scr; })[0].click(); }
  function store() { try { return JSON.parse(localStorage.getItem('k312_web_v1')); } catch (e) { return {}; } }

  window.onerror = function (m) {
    R.push('FAIL js:' + m);
    document.title = 'RESULT :: ' + R.join(' ;; ');
  };

  setTimeout(function () {
    try {
      /* ---- 首页 ---- */
      ok('首页默认显示', q('#s-home').classList.contains('on'));
      ok('打卡项渲染', qa('[data-ck]').length >= 4);
      var ckBtn = qa('[data-ck]').filter(function(b){return b.textContent==='打卡';})[0] || qa('[data-ck]')[0];
      var wasDone = ckBtn.textContent !== '打卡';
      ckBtn.click();
      var after = qa('[data-ck]').filter(function(b){return b.dataset.ck===ckBtn.dataset.ck;})[0];
      ok('打卡状态切换', wasDone ? after.textContent.indexOf('打卡')>=0 : after.textContent.indexOf('已完成')>=0);
      ok('邮件卡出现且含打卡项', q('#mailcard').style.display === 'block' && q('#m-body').textContent.indexOf('不背单词') >= 0);
      document.querySelector('[data-act="ck-add"]').click();
      q('#ckf-name').value = '英语真题阅读';
      q('#ckf-goal').value = '1';
      document.querySelector('[data-act="ckf-ok"]').click();
      ok('自定义打卡项新增', q('#cklist').textContent.indexOf('英语真题阅读') >= 0);
      ok('自定义打卡项落库', store().ckitems.some(function (c) { return c.name === '英语真题阅读'; }));
      document.querySelector('[data-act="ck-template"]').click();
      qa('[data-pk]')[0].checked = true;
      qa('[data-pk]')[1].checked = true;
      document.querySelector('[data-act="pk-ok"]').click();
      ok('计划模板生成', q('#cklist').textContent.indexOf('统计公式默写') >= 0);
      ok('打卡落库', Object.keys(store().checkin || {}).length >= 1);
      /* 番茄按钮切换 */
      var pb = q('#pbtn');
      pb.click();
      ok('番茄启动', pb.textContent === '暂停');
      pb.click();
      ok('番茄暂停', pb.textContent !== '暂停');

      /* ---- 题库 ---- */
      nav('bank');
      ok('题库屏切换', q('#s-bank').classList.contains('on'));
      ok('知识树五分册', qa('[data-part]').length === 5);
      ok('题号格子渲染', qa('[data-qn]').length > 0);
      ok('种子题已载入', store().items.length >= 200);
      var ans0 = q('#qans');
      if (ans0) {
        /* 简答：提交后应出现「可勾选的采分点清单」，而不是直接判对错 */
        ans0.value = '差别阈限与原刺激量之比是常数 ΔI/I=K 中等强度';
        document.querySelector('[data-act="q-submit"]').click();
        ok('简答提交出采分点清单', !!q('.judgebox'));
        ok('采分点可勾选(≥2)', qa('[data-jc]').length >= 2);
        var jc = qa('[data-jc]');
        if (jc.length) { jc[0].checked = true; jc[0].dispatchEvent(new Event('change')); }
        var jcBtn = document.querySelector('[data-act="judge-confirm"]');
        ok('有确认自评按钮', !!jcBtn);
        if (jcBtn) jcBtn.click();
        var rq = store().run;
        ok('自评后作答落库', !!rq && Object.keys(rq.answers || {}).length >= 1);
        document.querySelector('[data-act="q-submit"]').click();   /* 下一题 */
      } else {
        /* 选择题：直接判分 */
        var opt = q('[data-opt]'); if (opt) { opt.checked = true; opt.dispatchEvent(new Event('change')); }
        document.querySelector('[data-act="q-submit"]').click();
        ok('选择题提交出判定', !!q('.judgebox') || !!q('.judge'));
        document.querySelector('[data-act="q-submit"]').click();
      }
      ok('进度推进或结算', !!q('.qnums') || q('#s-bank').textContent.indexOf('本轮完成') >= 0);
      /* 四件套 */
      document.querySelector('[data-act="t-ex"]').click();
      ok('解析展开', !!q('.toolpanel .expl'));
      document.querySelector('[data-act="t-note"]').click();
      var ni = q('#note-in');
      if (ni) { ni.value = '口诀：韦伯分数很稳定'; ni.dispatchEvent(new Event('input')); }
      document.querySelector('[data-act="star"]').click();
      var meta = store().qmeta || {};
      ok('笔记收藏落库', Object.keys(meta).some(function (id) { return meta[id].note || meta[id].star; }));
      /* 点导论第一章（有题）开新组 */
      qa('[data-part]').filter(function (e) { return e.dataset.part === '心理学导论'; })[0].click();
      ok('分册展开出章', qa('[data-ch]').length > 0);
      qa('[data-ch]')[0].click();
      var run = store().run;
      ok('点章开新组且落库', !!run && qa('[data-qn]').length > 0);
      ok('新组标题带章名', !!run && /^第/.test(run.label || ''));

      /* ---- 学习：手动新增笔记 / 概念卡（导入区已按需求移除） ---- */
      nav('study');
      ok('学习屏已无导入区', document.body.textContent.indexOf('导入新知识') < 0);
      var N = String(Date.now()).slice(-4);
      var nb = document.querySelector('[data-act="compose"][data-kind="note"]');
      ok('有「新增笔记」按钮', !!nb);
      if (nb) {
        nb.click();
        ok('笔记表单出现', !!q('#cp-title') && !!q('#cp-body'));
        q('#cp-title').value = '回归测试笔记' + N;
        q('#cp-body').value = '这是一条用于回归验证的笔记正文，检查能否落库。';
        document.querySelector('[data-act="cp-save"]').click();
        ok('笔记落库', (store().notes || []).some(function (n) { return n.title.indexOf('回归测试笔记' + N) === 0; }));
      }
      var cb = document.querySelector('[data-act="compose"][data-kind="card"]');
      ok('有「新增概念卡」按钮', !!cb);
      if (cb) {
        cb.click();
        ok('概念卡表单出现', !!q('#cp-front') && !!q('#cp-back'));
        q('#cp-front').value = '回归术语' + N;
        q('#cp-back').value = '用于回归验证的释义。';
        document.querySelector('[data-act="cp-save"]').click();
        ok('概念卡落库', (store().cards || []).some(function (c) { return c.front.indexOf('回归术语' + N) === 0; }));
      }
      /* 导图：已换 jsMind，节点异步渲染，此处只断容器与库，不断节点数 */
      qa('#stabs button').filter(function (b) { return b.dataset.t === 'map'; })[0].click();
      ok('导图容器存在', !!q('#mm-canvas'));
      ok('导图库已加载', typeof window.jsMind !== 'undefined');
      ok('导图工具条渲染', qa('[data-mm]').length >= 6);

      /* ---- 复盘 ---- */
      nav('review');
      ok('复盘屏', q('#s-review').classList.contains('on'));
      ok('疑点出现在复核区', q('#s-review').textContent.indexOf('真会') >= 0);
      var dBefore = qa('[data-dok]').length;
      var dok = q('[data-dok]');
      if (dok) dok.click();
      ok('疑点裁决移除', qa('[data-dok]').length === dBefore - 1);
      ok('周复盘渲染', q('#s-review').textContent.indexOf('近 7 天复盘') >= 0);

      /* ---- 我的 ---- */
      nav('mine');
      ok('明细表15行', qa('table.dt tr').length === 15);
      ok('明细在「我的」内', q('#s-mine').contains(q('table.dt')));
      q('#set-mail').value = 'me@example.com';
      document.querySelector('[data-act="set-mail"]').click();
      ok('邮箱保存落库', store().settings.email === 'me@example.com');
      ok('知识库容量显示', q('#s-mine').textContent.indexOf('心理学导论') >= 0);

      ok('无JS异常', !R.some(function (r) { return r.indexOf('FAIL') === 0 && r.indexOf('js:') >= 0; }));
    } catch (e) {
      R.push('FAIL 异常:' + e.message);
    }
    document.title = 'RESULT :: ' + R.join(' ;; ');
  }, 1200);
})();
