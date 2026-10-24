/**
 * views/keys_view.js
 * [키 설정] 탭 뷰 - [Key...] 섹션 목록, 단축키 바인딩 및 순환 변수/상태값 관리
 */
import { toElement, getSectionDisplayName, getFullSectionName } from '../core/utils.js';
import {
  buildToggleSnippet,
  ensureConstantVariable,
  injectSectionProps,
  removeSectionFromText,
} from '../core/parser.js';
import { ensureActivePipeline } from '../core/active_pipeline.js';

export function createKeysView({ context, state, actions }) {
  const keysSplit = context.ui.createSplitView({
    direction: 'horizontal',
    initialSize: 320,
    minFirstSize: 220,
    minSecondSize: 300,
    resizable: true,
    storageKey: 'xxmi_toggle_mgr_split_keys',
  });

  if (keysSplit.container) {
    keysSplit.container.style.cssText += '; flex: 1 1 0; min-height: 0; height: 100%; width: 100%; overflow: hidden;';
  }

  const keysLeft = keysSplit.firstPane;
  const keysRight = keysSplit.secondPane;
  keysLeft.style.cssText += '; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%; padding-right: 6px; box-sizing: border-box;';
  keysRight.style.cssText += '; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%; padding-left: 6px; box-sizing: border-box;';

  let keysSearchQuery = '';

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
    if (!varName) return ['0', '1'];
    const cv = (state.constantVars || []).find(v => v.name.toLowerCase() === varName.toLowerCase());
    if (cv && Array.isArray(cv.states) && cv.states.length > 0) {
      return cv.states;
    }
    const tg = (state.toggles || []).find(t => (t.variableName || '').toLowerCase() === varName.toLowerCase());
    if (tg && Array.isArray(tg.states) && tg.states.length > 0) {
      return tg.states;
    }
    return ['0', '1'];
  }

  const keysSearch = context.ui.createSearchInput({
    placeholder: '토글 키 / 변수 검색…',
    debounceMs: 150,
    onSearch: (q) => {
      keysSearchQuery = q.toLowerCase();
      updateKeysList();
    },
    onClear: () => {
      keysSearchQuery = '';
      updateKeysList();
    },
  });

  const btnAddToggle = context.ui.createButton({
    text: '+ 새 토글 키 추가',
    variant: 'primary',
    onClick: () => {
      const idx = (state.toggles || []).length + 1;
      const availableVars = getAvailableVariables();
      const nextVar = availableVars[0] || '$outfit';
      const initialStates = getVarStatesList(nextVar).map(String);

      const newToggle = {
        id: `toggle_${Date.now()}`,
        sectionName: `KeyToggleOutfit${idx}`,
        comment: '',
        key: 'no_modifiers VK_F4',
        type: 'cycle',
        variableName: nextVar,
        states: initialStates,
        condition: '$active == 1',
      };
      state.toggles.push(newToggle);
      state.selectedToggleId = newToggle.id;
      context.logger?.info(`새 토글 키 추가: [${newToggle.sectionName}]`);
      updateKeysList();
      updateKeysDetail();
      actions.onKeysChanged?.();
    },
  });

  if (toElement(keysSearch)) keysLeft.append(toElement(keysSearch));
  keysLeft.append(toElement(btnAddToggle));

  const keysListScroll = context.ui.createScrollContainer({ direction: 'vertical' });
  keysLeft.append(keysListScroll.container);

  const keysRightScroll = context.ui.createScrollContainer({ direction: 'vertical' });
  keysRight.append(keysRightScroll.container);

  function updateKeysList() {
    keysListScroll.clear();
    const filtered = (state.toggles || []).filter(t => {
      if (!keysSearchQuery) return true;
      const sName = (t.sectionName || '').toLowerCase();
      const vName = (t.variableName || '').toLowerCase();
      const kVal = (t.key || '').toLowerCase();
      return sName.includes(keysSearchQuery) || vName.includes(keysSearchQuery) || kVal.includes(keysSearchQuery);
    });

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'color: var(--text-muted, #888); font-size: 12px; padding: 16px; text-align: center;';
      emptyDiv.textContent = (state.toggles || []).length === 0 ? '등록된 토글 키가 없습니다. 키보드 단축키가 필요한 경우 [+ 새 토글 키 추가]를 누르세요.' : '검색 결과가 없습니다.';
      keysListScroll.append(emptyDiv);
      return;
    }

    filtered.forEach(t => {
      const isSelected = t.id === state.selectedToggleId;
      const dispKey = context.ini?.formatDisplayKey
        ? context.ini.formatDisplayKey(t.key || '')
        : (t.key || '미설정');
      const statesCount = Array.isArray(t.states) ? t.states.length : 2;
      const item = context.ui.createListItem({
        title: t.sectionName,
        subtitle: `${t.variableName || '$var'} (${statesCount}단계) | ${dispKey}`,
        badge: t.type || 'cycle',
        selected: isSelected,
        onClick: () => {
          state.selectedToggleId = t.id;
          updateKeysList();
          updateKeysDetail();
        },
      });
      keysListScroll.append(toElement(item));
    });
  }

  function updateKeysDetail() {
    keysRightScroll.clear();
    const curToggle = (state.toggles || []).find(t => t.id === state.selectedToggleId) || (state.toggles || [])[0];
    if (!curToggle) {
      const notice = document.createElement('div');
      notice.style.cssText = 'color: var(--text-muted, #888); text-align: center; margin-top: 50px;';
      notice.textContent = '좌측에서 토글 키를 선택하거나 [+ 새 토글 키 추가]를 클릭하세요.';
      keysRightScroll.append(notice);
      return;
    }

    const toggle = curToggle;

    const btnApply = context.ui.createButton({
      text: '토글 키 저장',
      variant: 'primary',
      onClick: async () => {
        let cur = await actions.loadIniContent();
        const statesStr = Array.isArray(toggle.states) ? toggle.states.join(', ') : toggle.states;
        const props = {
          key: toggle.key || 'no_modifiers VK_F4',
          type: toggle.type || 'cycle',
          condition: '$active == 1',
        };
        if (toggle.variableName) {
          props[toggle.variableName] = statesStr;
          cur = ensureConstantVariable(cur, toggle.variableName, 0);
        }
        cur = injectSectionProps(cur, toggle.sectionName, props);
        cur = ensureActivePipeline(cur); // $active 파이프라인 자동 보장

        await actions.applyOrProposeIniChanges(cur, {
          title: `[${toggle.sectionName}] 토글 섹션 저장 제안`,
          description: `단축키(${toggle.key || ''}) 및 상태 변수(${toggle.variableName || ''}) 설정 변경 사항`,
          onAccepted: () => {
            updateKeysList();
            actions.onKeysChanged?.();
          },
        });
      },
    });

    const btnDelete = context.ui.createButton({
      text: '토글 키 삭제',
      variant: 'danger',
      onClick: async () => {
        const ok = await context.ui.confirm({
          title: '토글 키 섹션 삭제',
          message: `정말 '[${toggle.sectionName}]' 섹션을 삭제하시겠습니까?`,
          confirmText: '삭제',
          cancelText: '취소',
        });
        if (!ok) return;

        let cur = await actions.loadIniContent();
        cur = removeSectionFromText(cur, toggle.sectionName);

        context.logger?.info(`토글 키 섹션 삭제 제안: [${toggle.sectionName}]`);
        await actions.applyOrProposeIniChanges(cur, {
          title: `[${toggle.sectionName}] 토글 섹션 삭제 제안`,
          description: `'[${toggle.sectionName}]' 섹션을 제거합니다. 에디터 인라인 Diff에서 확인 후 수락하세요.`,
          onAccepted: () => {
            state.toggles = state.toggles.filter(t => t.id !== toggle.id);
            state.selectedToggleId = state.toggles.length > 0 ? state.toggles[0].id : null;
            updateKeysList();
            updateKeysDetail();
            actions.onKeysChanged?.();
          },
        });
      },
    });

    function validateSection(val) {
      const trimmed = (val || '').trim();
      if (!trimmed) {
        inputSection.setError?.('섹션 이름을 입력해야 합니다.');
        return false;
      }
      const full = getFullSectionName(trimmed).toLowerCase();
      const conflict = (state.toggles || []).some(t => t.id !== toggle.id && t.sectionName.toLowerCase() === full);
      if (conflict) {
        inputSection.setError?.('이미 존재하는 섹션 이름입니다.');
        return false;
      }
      inputSection.clearError?.();
      return true;
    }

    const inputSection = context.ui.createInput({
      label: '섹션 이름',
      value: getSectionDisplayName(toggle.sectionName),
      placeholder: 'ToggleDress',
      onInput: (val) => {
        validateSection(val);
        toggle.sectionName = getFullSectionName(val);
        updateKeysList();
        updatePreview();
      },
    });

    const keyInput = context.ui.createKeyInput({
      label: '발동 단축키',
      value: toggle.key || 'no_modifiers VK_F4',
      description: '단축키 입력창의 버튼을 누르고 키보드를 누르면 3DMigoto 키코드가 자동 입력됩니다.',
      onChange: (val) => {
        toggle.key = val;
        updateKeysList();
        updatePreview();
      },
    });

    const selectType = context.ui.createSelect({
      label: '토글 모드',
      value: toggle.type || 'cycle',
      options: [
        { value: 'cycle', label: '순환 토글 (cycle)' },
        { value: 'hold', label: '누르고 있을 때만 (hold)' },
      ],
      onChange: (val) => {
        toggle.type = val;
        updateKeysList();
        updatePreview();
      },
    });

    const availableVars = getAvailableVariables();
    const varOptions = availableVars.map(v => ({ value: v, label: v }));
    varOptions.push({ value: '__custom__', label: '(직접 입력…)' });

    let isCustomVar = !availableVars.includes(toggle.variableName);
    let selectVarWidget = null;
    let customVarInput = null;

    selectVarWidget = context.ui.createSelect({
      label: '연동 변수',
      value: isCustomVar ? '__custom__' : (toggle.variableName || availableVars[0]),
      options: varOptions,
      description: '1번 [변수 설정] 탭에 등록된 변수를 선택하여 이 단축키로 제어합니다.',
      onChange: (val) => {
        if (val === '__custom__') {
          isCustomVar = true;
          if (customVarInput) customVarInput.style.display = 'block';
        } else {
          isCustomVar = false;
          if (customVarInput) customVarInput.style.display = 'none';
          toggle.variableName = val;
          const vStates = getVarStatesList(val);
          toggle.states = vStates.map(String);
          inputStates.setValue?.(toggle.states.join(', '));
          updateKeysList();
          updatePreview();
          actions.onKeysChanged?.();
        }
      },
    });

    customVarInput = toElement(context.ui.createInput({
      label: '직접 입력 변수명',
      value: toggle.variableName || '',
      placeholder: '$dress',
      onInput: (val) => {
        let trimmed = val.trim();
        if (trimmed && !trimmed.startsWith('$')) trimmed = '$' + trimmed;
        toggle.variableName = trimmed;
        updateKeysList();
        updatePreview();
        actions.onKeysChanged?.();
      },
    }));
    if (customVarInput?.style) {
      customVarInput.style.display = isCustomVar ? 'block' : 'none';
    }

    const inputStates = context.ui.createInput({
      label: '순환 상태값',
      value: Array.isArray(toggle.states) ? toggle.states.join(', ') : toggle.states,
      placeholder: '0, 1 또는 0, 1, 2, 3',
      description: '단축키를 누를 때마다 순환할 상태값들을 쉼표로 구분하여 작성하세요.',
      onInput: (val) => {
        const parts = val.split(',').map(s => s.trim()).filter(Boolean);
        toggle.states = parts.length > 0 ? parts : ['0', '1'];
        updateKeysList();
        updatePreview();
        actions.onKeysChanged?.();
      },
    });

    let previewBlock = null;
    let fallbackPre = null;

    if (typeof context.ui.createCodeBlock === 'function') {
      previewBlock = context.ui.createCodeBlock({
        code: '',
        language: 'ini',
        copyable: true,
      });
    } else {
      fallbackPre = document.createElement('pre');
      fallbackPre.style.cssText = 'margin: 0; padding: 12px; background: var(--code-bg, #111); color: var(--code-fg, #7ee787); border-radius: 6px; font-family: monospace; font-size: 12px;';
    }

    function updatePreview() {
      const code = buildToggleSnippet(toggle);
      if (previewBlock && typeof previewBlock.setCode === 'function') {
        previewBlock.setCode(code);
      } else if (fallbackPre) {
        fallbackPre.textContent = code;
      }
    }

    const col = context.ui.createColumn({
      gap: 12,
      children: [
        toElement(inputSection),
        toElement(keyInput),
        toElement(selectType),
        toElement(selectVarWidget),
        customVarInput,
        toElement(inputStates),
      ].filter(Boolean),
    });

    const card = context.ui.createCard({
      title: `[${toggle.sectionName}] 토글 키 설정`,
      subtitle: `단축키: ${toggle.key || '미설정'} | 변수: ${toggle.variableName || '미설정'}`,
      content: col,
      actions: [btnDelete, btnApply].filter(Boolean),
    });

    const previewCard = context.ui.createCard({
      title: 'INI 섹션 코드 미리보기',
      content: toElement(previewBlock) || fallbackPre,
    });

    keysRightScroll.append(toElement(card) || card, toElement(previewCard) || previewCard);
    updatePreview();
  }

  return {
    container: keysSplit.container,
    updateList: updateKeysList,
    updateDetail: updateKeysDetail,
  };
}
