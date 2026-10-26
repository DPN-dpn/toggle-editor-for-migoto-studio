/**
 * views/vars_view.js
 * [변수 설정] 탭 뷰 - [Constants] 변수 목록 및 기본값/영구보존 관리
 */
import { toElement } from '../core/utils.js';
import { upsertConstantVariable, removeConstantVariable } from '../core/parser.js';

export function createVarsView({ context, state, actions }) {
  const varsSplit = context.ui.createSplitView({
    direction: 'horizontal',
    initialSize: 320,
    minFirstSize: 220,
    minSecondSize: 300,
    resizable: true,
    storageKey: 'xxmi_toggle_mgr_split_vars',
  });

  if (varsSplit.container) {
    varsSplit.container.style.cssText += '; flex: 1 1 0; min-height: 0; height: 100%; width: 100%; overflow: hidden;';
  }

  const varsLeft = varsSplit.firstPane;
  const varsRight = varsSplit.secondPane;
  varsLeft.style.cssText += '; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%; padding-right: 6px; box-sizing: border-box;';
  varsRight.style.cssText += '; display: flex; flex-direction: column; overflow: hidden; min-height: 0; height: 100%; padding-left: 6px; box-sizing: border-box;';

  let varsSearchQuery = '';

  const varsSearch = context.ui.createSearchInput({
    placeholder: '변수 검색…',
    debounceMs: 150,
    onSearch: (q) => {
      varsSearchQuery = q.toLowerCase();
      updateVarsList();
    },
    onClear: () => {
      varsSearchQuery = '';
      updateVarsList();
    },
  });

  const btnAddVar = context.ui.createButton({
    text: '+ 새 변수 추가',
    variant: 'primary',
    onClick: () => {
      const idx = state.constantVars.length + 1;
      const newVar = {
        id: `var_${Date.now()}`,
        name: `$custom_var_${idx}`,
        defaultValue: '0',
        isPersist: true,
      };
      state.constantVars.push(newVar);
      state.selectedVarId = newVar.id;
      context.logger?.info(`새 변수 추가: [${newVar.name}]`);
      updateVarsList();
      updateVarsDetail();
      actions.onVarsChanged?.();
    },
  });

  if (toElement(varsSearch)) varsLeft.append(toElement(varsSearch));
  varsLeft.append(toElement(btnAddVar));

  const varsListScroll = context.ui.createScrollContainer({ direction: 'vertical' });
  varsLeft.append(varsListScroll.container);

  const varsRightScroll = context.ui.createScrollContainer({ direction: 'vertical' });
  varsRight.append(varsRightScroll.container);

  function updateVarsList() {
    varsListScroll.clear();
    const filtered = (state.constantVars || []).filter(v => {
      if (!varsSearchQuery) return true;
      return v.name.toLowerCase().includes(varsSearchQuery);
    });

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'color: var(--text-muted, #888); font-size: 12px; padding: 16px; text-align: center;';
      emptyDiv.textContent = (state.constantVars || []).length === 0 ? '등록된 변수가 없습니다. [+ 새 변수 추가]를 누르세요.' : '검색 결과가 없습니다.';
      varsListScroll.append(emptyDiv);
      return;
    }

    filtered.forEach(v => {
      const isSelected = v.id === state.selectedVarId;
      const item = context.ui.createListItem({
        title: v.name,
        subtitle: `기본값: ${v.defaultValue || '0'}`,
        badge: v.isPersist ? 'persist' : 'temp',
        selected: isSelected,
        onClick: () => {
          state.selectedVarId = v.id;
          updateVarsList();
          updateVarsDetail();
        },
      });
      varsListScroll.append(toElement(item));
    });
  }

  function updateVarsDetail() {
    varsRightScroll.clear();
    const curVar = (state.constantVars || []).find(v => v.id === state.selectedVarId) || (state.constantVars || [])[0];
    if (!curVar) {
      const notice = document.createElement('div');
      notice.style.cssText = 'color: var(--text-muted, #888); text-align: center; margin-top: 50px;';
      notice.textContent = '좌측에서 변수를 선택하거나 [+ 새 변수 추가]를 클릭하세요.';
      varsRightScroll.append(notice);
      return;
    }

    const btnSaveVar = context.ui.createButton({
      text: '변수 저장',
      variant: 'primary',
      onClick: async () => {
        let cur = await actions.loadIniContent();
        cur = upsertConstantVariable(cur, curVar.name, curVar.defaultValue || '0', curVar.isPersist);
        await actions.applyOrProposeIniChanges(cur, {
          title: `[${curVar.name}] 변수 저장 제안`,
          description: `[Constants] 섹션에 '${curVar.name}' 선언 및 기본값(${curVar.defaultValue || '0'}) 반영`,
          onAccepted: () => {
            updateVarsList();
            actions.onVarsChanged?.();
          },
        });
      },
    });

    const btnDeleteVar = context.ui.createButton({
      text: '변수 삭제',
      variant: 'danger',
      onClick: async () => {
        const ok = await context.ui.confirm({
          title: '변수 삭제',
          message: `정말 '${curVar.name}' 변수를 [Constants]에서 삭제하시겠습니까?`,
          confirmText: '삭제',
          cancelText: '취소',
        });
        if (!ok) return;

        let cur = await actions.loadIniContent();
        cur = removeConstantVariable(cur, curVar.name);
        const hasConstants = /^\[Constants\]/im.test(cur);
        context.logger?.info(`변수 삭제 제안: [${curVar.name}]`);
        await actions.applyOrProposeIniChanges(cur, {
          title: `[${curVar.name}] 변수 삭제 제안`,
          description: hasConstants
            ? `[Constants] 섹션에서 '${curVar.name}' 변수 선언을 제거합니다.`
            : `[Constants] 섹션에서 '${curVar.name}' 변수를 제거하고, 남은 변수가 없으므로 [Constants] 섹션을 함께 삭제합니다.`,
          onAccepted: () => {
            state.constantVars = state.constantVars.filter(v => v.id !== curVar.id);
            state.selectedVarId = state.constantVars.length > 0 ? state.constantVars[0].id : null;
            updateVarsList();
            updateVarsDetail();
            actions.onVarsChanged?.();
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
      });
    } else {
      fallbackPre = document.createElement('pre');
      fallbackPre.style.cssText = 'margin: 0; padding: 12px; background: var(--code-bg, #111); color: var(--code-fg, #7ee787); border-radius: 6px; font-family: monospace; font-size: 12px;';
    }

    function updateVarPreview() {
      const scope = curVar.isPersist ? 'global persist' : 'global';
      const code = `[Constants]\n${scope} ${curVar.name} = ${curVar.defaultValue || '0'}`;
      if (previewBlock?.setCode) {
        previewBlock.setCode(code);
      } else if (fallbackPre) {
        fallbackPre.textContent = code;
      }
    }

    const inputVarName = context.ui.createInput({
      label: '변수명',
      value: curVar.name,
      placeholder: '$dress',
      description: '$ 기호로 시작하는 변수 이름을 입력하세요.',
      onInput: (val) => {
        let trimmed = val.trim();
        if (trimmed && !trimmed.startsWith('$')) trimmed = '$' + trimmed;
        curVar.name = trimmed;
        updateVarsList();
        updateVarPreview();
      },
    });

    const inputDefaultVal = context.ui.createInput({
      label: '기본값',
      value: String(curVar.defaultValue || '0'),
      placeholder: '0',
      description: '게임 시작 시 적용될 변수의 초기값입니다.',
      onInput: (val) => {
        curVar.defaultValue = val.trim() || '0';
        updateVarPreview();
      },
    });

    const chkPersist = context.ui.createCheckbox({
      label: '토글 유지',
      checked: curVar.isPersist !== false,
      onChange: (checked) => {
        curVar.isPersist = checked;
        updateVarPreview();
      },
    });

    const formCol = context.ui.createColumn({
      gap: 12,
      children: [
        toElement(inputVarName),
        toElement(inputDefaultVal),
        toElement(chkPersist),
      ].filter(Boolean),
    });

    const varCard = context.ui.createCard({
      title: `[${curVar.name}] 변수 설정`,
      subtitle: '[Constants] 섹션에 등록될 변수 속성',
      content: formCol,
      actions: [btnDeleteVar, btnSaveVar].filter(Boolean),
    });

    const previewCard = context.ui.createCard({
      title: '[Constants] 코드 미리보기',
      content: toElement(previewBlock) || fallbackPre,
    });

    varsRightScroll.append(toElement(varCard) || varCard, toElement(previewCard) || previewCard);
    updateVarPreview();
  }

  return {
    container: varsSplit.container,
    updateList: updateVarsList,
    updateDetail: updateVarsDetail,
  };
}
