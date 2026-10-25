/**
 * views/mesh_view.js
 * [조건문 설정] 탭 뷰 - 메쉬 섹션별 drawindexed / TTL / handling = skip 부위 조건문 관리
 */
import { toElement, detectConditionMode } from '../core/utils.js';
import { injectDrawIndexedConditions } from '../core/parser.js';
import { ensureActivePipeline } from '../core/active_pipeline.js';
import * as ttl from '../core/ttl.js';
import { openAddHashSkipModal } from '../components/skip_modal.js';

export function createMeshView({ context, state, actions }) {
  const meshSplit = context.ui.createSplitView({
    direction: 'horizontal',
    initialSize: 340,
    minFirstSize: 240,
    minSecondSize: 320,
    resizable: true,
    storageKey: 'xxmi_toggle_mgr_split_mesh',
  });

  if (meshSplit.container) {
    meshSplit.container.style.cssText += '; flex: 1 1 0; min-height: 0; height: 100%; width: 100%; overflow: hidden;';
  }

  const meshLeft = meshSplit.firstPane;
  const meshRight = meshSplit.secondPane;
  meshLeft.style.cssText += '; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%; padding-right: 6px; box-sizing: border-box;';
  meshRight.style.cssText += '; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%; padding-left: 6px; box-sizing: border-box;';

  const meshSectionSelectContainer = document.createElement('div');
  meshSectionSelectContainer.style.cssText = 'width: 100%; max-width: 100%; box-sizing: border-box; overflow: hidden;';

  meshLeft.append(meshSectionSelectContainer);

  const meshListScroll = context.ui.createScrollContainer({ direction: 'vertical' });
  meshLeft.append(meshListScroll.container);

  const meshRightScroll = context.ui.createScrollContainer({ direction: 'vertical' });
  meshRight.append(meshRightScroll.container);

  function getAvailableVariables() {
    const vars = new Set();
    if (Array.isArray(state.constantVars)) {
      state.constantVars.forEach(v => {
        if (v.name) vars.add(v.name);
      });
    }
    if (Array.isArray(state.toggles)) {
      state.toggles.forEach(t => {
        if (t.variableName) vars.add(t.variableName);
      });
    }
    return Array.from(vars);
  }

  function getVarStatesList(varName) {
    if (!varName) return [0, 1];
    const cv = (state.constantVars || []).find(v => v.name.toLowerCase() === varName.toLowerCase());
    if (cv && Array.isArray(cv.states) && cv.states.length > 0) {
      return cv.states.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    }
    const tg = (state.toggles || []).find(t => (t.variableName || '').toLowerCase() === varName.toLowerCase());
    if (tg && Array.isArray(tg.states) && tg.states.length > 0) {
      return tg.states.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    }
    return [0, 1];
  }

  function getVarMaxState(varName) {
    const list = getVarStatesList(varName);
    return Math.max(...list, 1);
  }

  function renderMeshSectionSelector() {
    meshSectionSelectContainer.innerHTML = '';
    const meshOptions = (state.meshSections || []).map(m => {
      const drawsCount = m.drawCalls ? m.drawCalls.length : 0;
      const typeLabel = m.isSkipSection ? '스킵' : `${drawsCount}개 파트`;
      const disp = m.sectionName.replace(/^TextureOverride/i, '') || m.sectionName;
      return {
        value: m.id,
        label: `${disp} (${typeLabel})`,
      };
    });

    if (meshOptions.length === 0) {
      meshOptions.push({ value: '', label: '(파싱된 메쉬 섹션 없음)' });
    }

    const meshSelect = context.ui.createSelect({
      label: '메쉬 섹션',
      options: meshOptions,
      value: state.selectedMeshId || (meshOptions[0] ? meshOptions[0].value : ''),
      onChange: (val) => {
        state.selectedMeshId = val;
        const cur = (state.meshSections || []).find(m => m.id === state.selectedMeshId);
        state.selectedDrawCallId = (cur && cur.drawCalls && cur.drawCalls[0]) ? cur.drawCalls[0].id : null;
        const call = cur?.drawCalls?.find(c => c.id === state.selectedDrawCallId);
        state.meshMode = detectConditionMode(call?.condition);
        updateMeshList();
        updateMeshDetail();
      },
    });

    const meshSelEl = toElement(meshSelect);
    if (meshSelEl) {
      meshSelEl.style.width = '100%';
      meshSelEl.style.maxWidth = '100%';
      meshSelEl.style.boxSizing = 'border-box';
      const internalSelect = meshSelEl.querySelector('select');
      if (internalSelect) {
        internalSelect.style.width = '100%';
        internalSelect.style.maxWidth = '100%';
        internalSelect.style.boxSizing = 'border-box';
        internalSelect.style.textOverflow = 'ellipsis';
      }
    }

    meshSectionSelectContainer.appendChild(meshSelEl || toElement(meshSelect));

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 6px; width: 100%; margin-top: 2px; margin-bottom: 6px;';

    const btnAddSkipSec = context.ui.createButton({
      text: '+ 스킵 섹션 추가',
      variant: 'secondary',
      onClick: () => {
        openAddHashSkipModal({
          context,
          meshSections: state.meshSections,
          onConfirm: async ({ sectionName, hash }) => {
            let currentFull = await actions.loadIniContent();
            currentFull += `\n[${sectionName}]\nhash = ${hash}\n`;
            if (state.toggles && state.toggles.length > 0) {
              currentFull = ensureActivePipeline(currentFull);
            }

            context.logger?.info(`새 해시 스킵 섹션 추가 제안: [${sectionName}] (hash: ${hash})`);
            await actions.applyOrProposeIniChanges(currentFull, {
              title: `[${sectionName}] 스킵 섹션 추가 제안`,
              description: `해시(${hash}) 기반 신규 스킵 섹션 생성 검토`,
              onAccepted: () => {
                const created = (state.meshSections || []).find(m => m.sectionName.toLowerCase() === sectionName.toLowerCase());
                if (created) {
                  state.selectedMeshId = created.id;
                  state.selectedDrawCallId = created.drawCalls && created.drawCalls[0] ? created.drawCalls[0].id : null;
                  state.meshMode = 'simple';
                  renderMeshSectionSelector();
                  updateMeshList();
                  updateMeshDetail();
                }
              },
            });
          },
        });
      },
    });
    const btnAddSkipEl = toElement(btnAddSkipSec);
    if (btnAddSkipEl?.style) {
      btnAddSkipEl.style.flex = '1 1 0';
      btnAddSkipEl.style.minWidth = '0';
    }

    const btnResetAllMeshConds = context.ui.createButton({
      text: '전체 조건문 초기화',
      variant: 'secondary',
      onClick: async () => {
        const confirmed = await context.ui.confirm({
          title: '전체 조건문 초기화',
          message: '문서 내 모든 메쉬 섹션의 조건문을 초기화하여 상시 렌더링 상태로 되돌리시겠습니까?\n([적용] 버튼을 누르기 전까지는 파일이 변경되지 않습니다.)',
          confirmText: '전체 초기화',
          cancelText: '취소',
        });
        if (!confirmed) return;

        (state.meshSections || []).forEach(m => {
          if (m.drawCalls) {
            m.drawCalls.forEach(call => {
              call.condition = null;
            });
          }
        });
        state.meshMode = 'simple';
        updateMeshList();
        updateMeshDetail();
        context.logger?.info('문서 내 모든 메쉬 섹션의 조건문이 일괄 초기화되었습니다.');
        context.ui.showToast('모든 메쉬 조건문이 초기화되었습니다. [적용]을 눌러 파일에 반영하세요.', 'info');
      },
    });
    const btnResetAllEl = toElement(btnResetAllMeshConds);
    if (btnResetAllEl?.style) {
      btnResetAllEl.style.flex = '1 1 0';
      btnResetAllEl.style.minWidth = '0';
    }

    btnRow.append(btnAddSkipEl, btnResetAllEl);
    meshSectionSelectContainer.appendChild(btnRow);
  }

  function updateMeshList() {
    meshListScroll.clear();
    const curMesh = (state.meshSections || []).find(m => m.id === state.selectedMeshId);
    if (!curMesh || !curMesh.drawCalls || curMesh.drawCalls.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'color: var(--text-muted, #888); font-size: 12px; padding: 16px; text-align: center;';
      emptyDiv.textContent = '해당 메쉬 섹션에 파싱된 draw/스킵 구문이 없습니다.';
      meshListScroll.append(emptyDiv);
      return;
    }

    curMesh.drawCalls.forEach((call, idx) => {
      const isSelected = call.id === state.selectedDrawCallId;
      const isCond = Boolean(call.condition && call.condition.trim());
      const isSkipCall = call.value === 'handling = skip';
      const isTtlCall = Boolean(call.isTTL);
      let title = call.name;
      if (!title) {
        if (isSkipCall) title = '메쉬 지우기';
        else if (isTtlCall) title = `반투명 파트 #${idx + 1} (TTL)`;
        else title = `부위 #${idx + 1}`;
      }
      let badgeText = '';
      if (isCond) {
        if (isSkipCall) badgeText = `if ${call.condition} (스킵)`;
        else if (isTtlCall) badgeText = `if ${call.condition} (TTL)`;
        else badgeText = call.condition;
      } else {
        if (isSkipCall) badgeText = '상시 표시 (보임)';
        else if (isTtlCall) badgeText = '상시 렌더링 (TTL)';
        else badgeText = '상시 렌더링';
      }

      const itemEl = document.createElement('div');
      itemEl.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 9px 12px;
        border-radius: 6px;
        cursor: pointer;
        background: ${isSelected ? 'var(--selected-bg, rgba(56, 139, 253, 0.15))' : 'rgba(255, 255, 255, 0.03)'};
        border: 1px solid ${isSelected ? 'var(--accent-color, #388bfd)' : 'transparent'};
        transition: all 0.15s ease;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
      `;
      itemEl.onmouseenter = () => {
        if (call.id !== state.selectedDrawCallId) itemEl.style.background = 'rgba(255, 255, 255, 0.08)';
      };
      itemEl.onmouseleave = () => {
        if (call.id !== state.selectedDrawCallId) itemEl.style.background = 'rgba(255, 255, 255, 0.03)';
      };

      const titleEl = document.createElement('div');
      titleEl.style.cssText = `
        font-weight: 600;
        font-size: 13px;
        line-height: 1.4;
        color: var(--text-color, #e6edf3);
        word-break: break-all;
        white-space: normal;
        width: 100%;
      `;
      titleEl.textContent = title;

      const metaRow = document.createElement('div');
      metaRow.style.cssText = `
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        width: 100%;
        margin-top: 2px;
      `;

      const badgeEl = document.createElement('span');
      badgeEl.style.cssText = `
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: ${isCond ? 'var(--accent-color, #58a6ff)' : 'var(--text-muted, #8b949e)'};
        font-family: monospace;
        word-break: break-all;
        white-space: normal;
        line-height: 1.35;
        max-width: 100%;
        box-sizing: border-box;
      `;
      badgeEl.textContent = badgeText;

      metaRow.append(badgeEl);
      itemEl.append(titleEl, metaRow);

      itemEl.addEventListener('click', () => {
        state.selectedDrawCallId = call.id;
        state.meshMode = detectConditionMode(call.condition);
        updateMeshList();
        updateMeshDetail();
      });

      meshListScroll.append(itemEl);
    });
  }

  function updateMeshDetail() {
    meshRightScroll.clear();
    const curMesh = (state.meshSections || []).find(m => m.id === state.selectedMeshId);
    if (!curMesh) {
      const notice = document.createElement('div');
      notice.style.cssText = 'color: var(--text-muted, #888); text-align: center; margin-top: 50px;';
      notice.textContent = '좌측에서 메쉬 섹션을 선택하세요.';
      meshRightScroll.append(notice);
      return;
    }

    const curDrawCall = (curMesh.drawCalls || []).find(c => c.id === state.selectedDrawCallId) || (curMesh.drawCalls && curMesh.drawCalls[0]);
    if (!curDrawCall) {
      const notice = document.createElement('div');
      notice.style.cssText = 'color: var(--text-muted, #888); text-align: center; margin-top: 50px;';
      notice.textContent = '파싱된 drawindexed 항목이 없습니다. INI 파일에 drawindexed 구문이 존재하는지 확인하세요.';
      meshRightScroll.append(notice);
      return;
    }

    const varNames = getAvailableVariables();

    const modeSegment = context.ui.createSegmentedControl({
      label: '조건문 설정 모드',
      options: [
        { value: 'simple', label: '단순 모드' },
        { value: 'advanced', label: '어드밴스드 모드' },
        { value: 'custom', label: '직접 입력' },
      ],
      value: state.meshMode || 'simple',
      onChange: (val) => {
        state.meshMode = val;
        updateMeshDetail();
      },
    });

    const btnResetMeshConds = context.ui.createButton({
      text: '조건문 초기화',
      variant: 'secondary',
      onClick: async () => {
        const confirmed = await context.ui.confirm({
          title: '조건문 초기화',
          message: `[${curMesh.sectionName}] 섹션의 모든 부위 조건문을 초기화하여 상시 렌더링 상태로 되돌리시겠습니까?\n([적용] 버튼을 누르기 전까지는 파일이 변경되지 않습니다.)`,
          confirmText: '초기화',
          cancelText: '취소',
        });
        if (!confirmed) return;

        curMesh.drawCalls.forEach(call => {
          call.condition = null;
        });
        state.meshMode = 'simple';
        updateMeshList();
        updateMeshDetail();
        context.logger?.info(`[${curMesh.sectionName}] 섹션의 모든 부위 조건문이 초기화되었습니다.`);
        context.ui.showToast(`[${curMesh.sectionName}] 조건문이 초기화되었습니다. [적용]을 눌러 파일에 반영하세요.`, 'info');
      },
    });

    const btnApplyMesh = context.ui.createButton({
      text: '메쉬 섹션에 적용',
      variant: 'primary',
      onClick: async () => {
        let cur = await actions.loadIniContent();
        cur = injectDrawIndexedConditions(cur, curMesh.sectionName, curMesh.drawCalls);
        if (state.toggles && state.toggles.length > 0) {
          cur = ensureActivePipeline(cur); // $active 파이프라인 자동 보장
        }
        await actions.applyOrProposeIniChanges(cur, {
          title: `[${curMesh.sectionName}] 조건문 적용 제안`,
          description: curMesh.isSkipSection
            ? '악세서리/소품 스킵(지우기) 조건문 변경 검토'
            : '서브메쉬 파트별 drawindexed 조건문 변경 검토',
          onAccepted: () => {
            updateMeshList();
          },
        });
      },
    });

    let previewBlock = null;
    let fallbackPre = null;

    if (typeof context.ui.createCodeBlock === 'function') {
      previewBlock = context.ui.createCodeBlock({
        code: '',
        language: 'ini',
        copyable: true,
        maxHeight: 250,
      });
    } else {
      fallbackPre = document.createElement('pre');
      fallbackPre.style.cssText = 'margin: 0; padding: 12px; background: var(--code-bg, #111); color: var(--code-fg, #7ee787); border-radius: 6px; font-family: monospace; font-size: 12px; overflow-x: auto;';
    }

    function updatePreviewCode() {
      let code = '';
      if (curDrawCall.isTTL) {
        const hasCond = curDrawCall.condition && curDrawCall.condition.trim();
        const innerIndent = hasCond ? '    ' : '';
        const ttlLines = ttl.formatTtlLines(curDrawCall, innerIndent);
        if (hasCond) {
          code = `if ${curDrawCall.condition.trim()}\n${ttlLines.join('\n')}\nendif`;
        } else {
          code = ttlLines.join('\n');
        }
      } else if (curDrawCall.value === 'handling = skip') {
        if (curDrawCall.comment) {
          curDrawCall.comment.split('\n').forEach(c => {
            code += `; ${c.trim()}\n`;
          });
        }
        if (curDrawCall.condition && curDrawCall.condition.trim()) {
          code += `if ${curDrawCall.condition.trim()}\n    handling = skip\nendif`;
        } else {
          code += `; (상시 표시: handling = skip 구문이 들어가지 않아 원본 메쉬가 항상 보입니다)`;
        }
      } else {
        if (curDrawCall.comment) {
          curDrawCall.comment.split('\n').forEach(c => {
            code += `; ${c.trim()}\n`;
          });
        }
        if (curDrawCall.condition && curDrawCall.condition.trim()) {
          code += `if ${curDrawCall.condition.trim()}\n    drawindexed = ${curDrawCall.value || 'auto'}\nendif`;
        } else {
          code += `drawindexed = ${curDrawCall.value || 'auto'}`;
        }
      }

      if (previewBlock && typeof previewBlock.setCode === 'function') {
        previewBlock.setCode(code);
      } else if (fallbackPre) {
        fallbackPre.textContent = code;
      }
    }

    let modeWidgets = [];

    // [MODE 1] 단순 모드
    if ((state.meshMode || 'simple') === 'simple') {
      let currentVar = curDrawCall._simpleVar || varNames[0];
      const selectedStates = new Set();

      if (curDrawCall.condition && curDrawCall.condition.trim()) {
        const cond = curDrawCall.condition.trim();
        for (const vn of varNames) {
          if (cond.includes(vn)) {
            currentVar = vn;
            curDrawCall._simpleVar = vn;
            break;
          }
        }
        const stateMatches = cond.matchAll(/(?:==|=)\s*(\d+)/g);
        for (const m of stateMatches) {
          selectedStates.add(parseInt(m[1], 10));
        }
      }

      function updateSimpleCondition() {
        if (selectedStates.size === 0) {
          curDrawCall.condition = null;
        } else {
          const sorted = Array.from(selectedStates).sort((a, b) => a - b);
          curDrawCall.condition = sorted.map(st => `${currentVar} == ${st}`).join(' || ');
        }
        updatePreviewCode();
        updateSimpleFormula();
      }

      // 변수의 상태 가짓수에 맞춰 칩 옵션을 구성하고, 유효하지 않은 선택은 제거
      function buildStateOptions() {
        const statesList = getVarStatesList(currentVar);
        const validSet = new Set(statesList);
        for (const s of Array.from(selectedStates)) {
          if (!validSet.has(s)) selectedStates.delete(s);
        }
        return statesList.map(s => ({ value: String(s), label: String(s) }));
      }

      const stateChips = context.ui.createChipGroup({
        label: '상태값 다중 선택',
        multiple: true,
        options: buildStateOptions(),
        value: Array.from(selectedStates).map(String),
        onChange: (values) => {
          selectedStates.clear();
          values.forEach(v => selectedStates.add(parseInt(v, 10)));
          updateSimpleCondition();
        },
      });

      const selectVar = context.ui.createSelect({
        label: '변수',
        value: currentVar,
        options: varNames.map(v => ({ value: v, label: v })),
        onChange: (val) => {
          currentVar = val;
          curDrawCall._simpleVar = val;
          selectedStates.clear();
          stateChips.setOptions(buildStateOptions());
          stateChips.setValue([]);
          updateSimpleCondition();
        },
      });

      const simpleFormulaBox = document.createElement('div');
      simpleFormulaBox.style.cssText = 'padding: 9px 12px; background: rgba(56, 139, 253, 0.1); border-left: 3px solid var(--accent-color, #388bfd); border-radius: 4px; font-size: 12px; font-family: monospace; color: var(--text-color, #e6edf3); word-break: break-all; margin-top: 4px;';

      function updateSimpleFormula() {
        if (curDrawCall.isTTL) {
          simpleFormulaBox.textContent = curDrawCall.condition
            ? `적용 수식: if ${curDrawCall.condition} -> TTL Draw (해당 조건일 때 반투명 렌더링)`
            : '선택된 상태값이 없어 상시 반투명 렌더링(TTL Draw)됩니다.';
        } else if (curDrawCall.value === 'handling = skip') {
          simpleFormulaBox.textContent = curDrawCall.condition
            ? `적용 수식: if ${curDrawCall.condition} -> handling = skip (해당 조건일 때 메쉬 지움)`
            : '선택된 상태값이 없어 handling = skip이 들어가지 않습니다. (메쉬가 항상 표시됨)';
        } else {
          simpleFormulaBox.textContent = curDrawCall.condition
            ? `적용 수식: ${curDrawCall.condition}`
            : '선택된 상태값이 없어 상시 렌더링됩니다.';
        }
      }
      updateSimpleFormula();

      modeWidgets = [
        selectVar,
        stateChips,
        simpleFormulaBox,
      ];

      updateSimpleCondition();
    }
    // [MODE 2] 어드밴스드 모드
    else if (state.meshMode === 'advanced') {
      let currentAdvOp = '&&';
      if (curDrawCall.condition && curDrawCall.condition.includes('||') && !curDrawCall.condition.includes('&&')) {
        currentAdvOp = '||';
      }

      let advRules = [];
      if (curDrawCall.condition && curDrawCall.condition.trim()) {
        const cond = curDrawCall.condition.trim();
        const ruleMatches = cond.matchAll(/(\$\w+)\s*(?:==|=)\s*(\d+)/g);
        let rId = 0;
        for (const m of ruleMatches) {
          advRules.push({
            id: ++rId,
            varName: m[1],
            val: parseInt(m[2], 10),
          });
        }
      }

      if (advRules.length === 0) {
        advRules.push({
          id: 1,
          varName: varNames[0] || '$var1',
          val: 1,
        });
        if (varNames.length > 1) {
          advRules.push({
            id: 2,
            varName: varNames[1],
            val: 1,
          });
        }
      }

      function updateAdvancedCondition() {
        if (advRules.length === 0) {
          curDrawCall.condition = null;
        } else {
          curDrawCall.condition = advRules
            .map(r => `${r.varName} == ${r.val}`)
            .join(` ${currentAdvOp} `);
        }
        updatePreviewCode();
        updateAdvFormula();
      }

      const advOpSegment = context.ui.createSegmentedControl({
        label: '결합 방식',
        options: [
          { value: '&&', label: 'AND' },
          { value: '||', label: 'OR' },
        ],
        value: currentAdvOp,
        onChange: (val) => {
          currentAdvOp = val;
          updateAdvancedCondition();
          updateAdvFormula();
        },
      });

      const rulesCard = document.createElement('div');
      rulesCard.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 4px;';

      const rulesHeader = document.createElement('div');
      rulesHeader.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-color, #e6edf3);';
      rulesHeader.textContent = '조건 규칙 목록';

      const rulesListContainer = document.createElement('div');
      rulesListContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

      function renderAdvRules() {
        rulesListContainer.innerHTML = '';
        advRules.forEach((rule) => {
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.03); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));';

          const sel = document.createElement('select');
          sel.style.cssText = 'flex: 1; padding: 6px 8px; border-radius: 4px; background: var(--input-bg, #1e1e1e); color: var(--text-color, #e6edf3); border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15)); font-size: 12px;';
          varNames.forEach(vn => {
            const opt = document.createElement('option');
            opt.value = vn;
            opt.textContent = vn;
            if (vn === rule.varName) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.onchange = (e) => {
            rule.varName = e.target.value;
            const maxS = getVarMaxState(rule.varName);
            if (rule.val > maxS) rule.val = maxS;
            numInput.max = String(maxS);
            numInput.value = String(rule.val);
            updateAdvancedCondition();
          };

          const eqLabel = document.createElement('span');
          eqLabel.textContent = '==';
          eqLabel.style.cssText = 'font-weight: bold; font-family: monospace; color: var(--accent-color, #388bfd); font-size: 13px;';

          const maxS = getVarMaxState(rule.varName);
          const numInput = document.createElement('input');
          numInput.type = 'number';
          numInput.min = '0';
          numInput.max = String(maxS);
          numInput.value = String(rule.val);
          numInput.title = `0 ~ ${maxS}`;
          numInput.style.cssText = 'width: 58px; padding: 6px 8px; border-radius: 4px; background: var(--input-bg, #1e1e1e); color: var(--text-color, #e6edf3); border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15)); font-size: 12px; text-align: center;';
          numInput.oninput = (e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v) || v < 0) v = 0;
            const curMax = getVarMaxState(rule.varName);
            if (v > curMax) v = curMax;
            rule.val = v;
            updateAdvancedCondition();
          };

          const btnDel = document.createElement('button');
          btnDel.type = 'button';
          btnDel.textContent = '✕';
          btnDel.title = '이 규칙 삭제';
          btnDel.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: transparent; border: 1px solid var(--border-color, rgba(255, 255, 255, 0.15)); color: var(--text-muted, #8b949e); cursor: pointer; font-size: 12px; line-height: 1;';
          btnDel.onmouseenter = () => { btnDel.style.color = '#f85149'; btnDel.style.borderColor = '#f85149'; };
          btnDel.onmouseleave = () => { btnDel.style.color = 'var(--text-muted, #8b949e)'; btnDel.style.borderColor = 'var(--border-color, rgba(255, 255, 255, 0.15))'; };
          btnDel.onclick = () => {
            advRules = advRules.filter(r => r.id !== rule.id);
            renderAdvRules();
            updateAdvancedCondition();
          };

          row.append(sel, eqLabel, numInput, btnDel);
          rulesListContainer.appendChild(row);
        });
      }

      renderAdvRules();

      const btnAddRule = document.createElement('button');
      btnAddRule.type = 'button';
      btnAddRule.textContent = '+ 규칙 추가';
      btnAddRule.style.cssText = 'align-self: flex-start; padding: 6px 12px; border-radius: 4px; background: rgba(255, 255, 255, 0.05); border: 1px dashed var(--border-color, rgba(255, 255, 255, 0.25)); color: var(--text-color, #e6edf3); font-size: 12px; cursor: pointer; margin-top: 4px;';
      btnAddRule.onmouseenter = () => { btnAddRule.style.background = 'rgba(255, 255, 255, 0.1)'; };
      btnAddRule.onmouseleave = () => { btnAddRule.style.background = 'rgba(255, 255, 255, 0.05)'; };
      btnAddRule.onclick = () => {
        const usedVars = new Set(advRules.map(r => r.varName));
        const nextVar = varNames.find(v => !usedVars.has(v)) || varNames[0] || '$var';
        advRules.push({
          id: Date.now(),
          varName: nextVar,
          val: 1,
        });
        renderAdvRules();
        updateAdvancedCondition();
      };

      rulesCard.append(rulesHeader, rulesListContainer, btnAddRule);

      const advFormulaBox = document.createElement('div');
      advFormulaBox.style.cssText = 'padding: 9px 12px; background: rgba(56, 139, 253, 0.1); border-left: 3px solid var(--accent-color, #388bfd); border-radius: 4px; font-size: 12px; font-family: monospace; color: var(--text-color, #e6edf3); word-break: break-all; margin-top: 4px;';

      function updateAdvFormula() {
        if (curDrawCall.isTTL) {
          advFormulaBox.textContent = curDrawCall.condition
            ? `적용 수식: if ${curDrawCall.condition} -> TTL Draw (해당 조건일 때 반투명 렌더링)`
            : '규칙이 없어 상시 반투명 렌더링(TTL Draw)됩니다.';
        } else if (curDrawCall.value === 'handling = skip') {
          advFormulaBox.textContent = curDrawCall.condition
            ? `적용 수식: if ${curDrawCall.condition} -> handling = skip (해당 조건일 때 메쉬 지움)`
            : '규칙이 없어 handling = skip이 들어가지 않습니다. (메쉬가 항상 표시됨)';
        } else {
          advFormulaBox.textContent = curDrawCall.condition
            ? `적용 수식: ${curDrawCall.condition}`
            : '규칙이 없어 상시 렌더링됩니다.';
        }
      }
      updateAdvFormula();

      modeWidgets = [
        advOpSegment,
        rulesCard,
        advFormulaBox,
      ];

      updateAdvancedCondition();
    }
    // [MODE 3] 직접 입력
    else {
      const customDesc = curDrawCall.isTTL
        ? '단순/어드밴스드 모드로 표현되지 않는 복잡한 수식을 자유롭게 작성하세요. 비워두면 상시 반투명 렌더링(TTL Draw)됩니다.'
        : (curDrawCall.value === 'handling = skip'
          ? '단순/어드밴스드 모드로 표현되지 않는 수식을 작성하세요. 비워두면 스킵 구문이 들어가지 않아 항상 표시됩니다.'
          : '단순/어드밴스드 모드로 표현되지 않는 복잡한 수식이나 시스템 변수를 자유롭게 작성하세요. 비워두면 상시 렌더링됩니다.');

      const inputCustomCond = context.ui.createInput({
        label: '조건식',
        value: curDrawCall.condition || '',
        placeholder: '예: DRAW_TYPE == 1, $active == 1 && $dress > 0',
        description: customDesc,
        onInput: (val) => {
          curDrawCall.condition = val.trim() || null;
          updatePreviewCode();
        },
      });

      modeWidgets = [
        inputCustomCond,
      ];

      updatePreviewCode();
    }

    const modeInnerEl = toElement(context.ui.createColumn({
      gap: 14,
      children: [
        modeSegment,
        ...modeWidgets,
      ].filter(Boolean),
    }));

    const isSkipMesh = curDrawCall.value === 'handling = skip';
    const isTtlMesh = Boolean(curDrawCall.isTTL);
    const mainCard = context.ui.createCard({
      title: curDrawCall.name ? `[${curDrawCall.name}] 조건문 설정` : `[${curMesh.sectionName}] 조건문 설정`,
      subtitle: isSkipMesh
        ? `섹션: ${curMesh.sectionName} (메쉬 지우기 / 스킵 섹션)`
        : (isTtlMesh ? `섹션: ${curMesh.sectionName} (TTL 반투명 드로우 블록)` : `섹션: ${curMesh.sectionName}`),
      content: modeInnerEl,
      actions: [btnResetMeshConds, btnApplyMesh].filter(Boolean),
    });

    const previewCard = context.ui.createCard({
      title: isSkipMesh ? 'handling = skip 코드 미리보기' : (isTtlMesh ? 'TTL CommandList 코드 미리보기' : 'drawindexed 코드 미리보기'),
      content: toElement(previewBlock) || fallbackPre,
    });

    meshRightScroll.append(toElement(mainCard) || mainCard, toElement(previewCard) || previewCard);
  }

  return {
    container: meshSplit.container,
    renderSectionSelector: renderMeshSectionSelector,
    updateList: updateMeshList,
    updateDetail: updateMeshDetail,
  };
}
