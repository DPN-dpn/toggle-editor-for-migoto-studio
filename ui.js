/**
 * XXMI 토글 & 메쉬 매니저 - 메인 UI 컨트롤러 모듈
 * 탭 구성: [변수 설정] [키 설정] [조건문 설정]
 * $active 파이프라인 자동화 및 인라인 Diff 연동
 * Migoto Studio 신규 생명주기 API 연동:
 * - context.workspace.onDidClearMemory (모드 폴더 닫힘/변경/리셋 시 메모리 소거)
 * - context.workspace.onDidChangeActiveFolder (모드 폴더 변경/열림/닫힘 실시간 감지)
 * - context.workspace.onDidSaveFile (외부 INI 파일 저장 시 자동 동기화)
 */
import {
  toElement,
  getSectionDisplayName,
  getFullSectionName,
  getVarDisplayName,
  detectConditionMode,
  scanIniFiles,
  removeEmptySection,
} from './core/utils.js';
import {
  parseIniDocument,
  upsertConstantVariable,
  removeConstantVariable,
  ensureConstantVariable,
  injectSectionProps,
  removeSectionFromText,
  injectDrawIndexedConditions,
} from './core/parser.js';
import { ensureActivePipeline, removeActivePipeline } from './core/active_pipeline.js';
import { createToolbar } from './components/toolbar.js';
import { createVarsView } from './views/vars_view.js';
import { createKeysView } from './views/keys_view.js';
import { createMeshView } from './views/mesh_view.js';

export {
  getSectionDisplayName,
  getFullSectionName,
  getVarDisplayName,
  detectConditionMode,
  scanIniFiles,
};

/**
 * 메인 토글 매니저 탭 렌더링 함수
 */
export async function renderToggleManagerTab(container, context) {
  let iniFiles = await scanIniFiles(context);
  let currentIniPath = (iniFiles.length > 0 ? iniFiles[0].path : null);

  async function loadIniContent() {
    if (currentIniPath && typeof context.workspace?.readTextFile === 'function') {
      try {
        return await context.workspace.readTextFile(currentIniPath);
      } catch (err) {
        context.logger?.warn('readTextFile error, fallback to editor:', err);
      }
    }
    return (context.editor && typeof context.editor.getText === 'function') ? context.editor.getText() : '';
  }

  async function saveIniContent(newContent) {
    if (currentIniPath && typeof context.workspace?.writeTextFile === 'function') {
      try {
        await context.workspace.writeTextFile(currentIniPath, newContent);
      } catch (err) {
        context.logger?.warn('writeTextFile error:', err);
      }
    }
    if (context.editor && typeof context.editor.setText === 'function') {
      context.editor.setText(newContent);
    }
  }

  async function applyOrProposeIniChanges(newContent, options = {}) {
    const { onAccepted } = options;
    if (!newContent) return false;

    context.logger?.info(`[${options.title || 'INI 변경'}] 인라인 변경 제안 전송`);

    if (currentIniPath && typeof context.workspace?.openFile === 'function') {
      try {
        await context.workspace.openFile(currentIniPath);
        await new Promise(r => setTimeout(r, 80));
      } catch (e) {
        context.logger?.warn('openFile failed:', e);
      }
    }

    if (typeof context.editor?.proposeChanges === 'function') {
      try {
        const result = await context.editor.proposeChanges(newContent);
        if (result && result.accepted) {
          const finalContent = context.editor.getText() || newContent;
          if (currentIniPath && typeof context.workspace?.writeTextFile === 'function') {
            try {
              await context.workspace.writeTextFile(currentIniPath, finalContent);
            } catch (err) {
              context.logger?.error('writeTextFile failed:', err);
            }
          }
          if (typeof context.workspace?.saveCurrentFile === 'function') {
            try {
              await context.workspace.saveCurrentFile();
            } catch (_) { }
          }
          await reloadDocument(true);
          if (typeof onAccepted === 'function') onAccepted();
          context.logger?.info(`[${options.title || 'INI 변경'}] 변경 사항이 수락되어 파일에 반영되었습니다.`);
          context.ui.showToast('변경 사항이 수락되어 INI에 반영되었습니다.', 'info');
          return true;
        } else {
          context.logger?.warn(`[${options.title || 'INI 변경'}] 사용자가 변경 제안을 되돌렸습니다.`);
          context.ui.showToast('변경이 취소되고 원래 코드로 복구되었습니다.', 'warn');
          return false;
        }
      } catch (err) {
        context.logger?.error('proposeChanges error, falling back to direct save:', err);
      }
    }

    await saveIniContent(newContent);
    await reloadDocument(true);
    if (typeof onAccepted === 'function') onAccepted();
    context.logger?.info(`[${options.title || 'INI 변경'}] 파일에 직접 반영되었습니다.`);
    context.ui.showToast('INI에 반영되었습니다.', 'info');
    return true;
  }

  const hasInitialFolder = Boolean(context.workspace?.getCurrentFolder?.());
  let rawIni = hasInitialFolder || currentIniPath ? await loadIniContent() : '';
  let doc = parseIniDocument(rawIni);

  function pickBestMesh(sections) {
    if (!sections || sections.length === 0) return null;
    const withDraws = sections.find(s => s.drawCalls && s.drawCalls.length > 0);
    return withDraws ? withDraws.id : sections[0].id;
  }

  // 통합 상태 객체 (모든 서브 뷰가 참조 및 조작)
  const state = {
    currentIniPath,
    toggles: doc.toggles,
    constants: doc.constants,
    constantVars: doc.constantVars || [],
    meshSections: doc.meshSections,
    selectedVarId: (doc.constantVars && doc.constantVars.length > 0) ? doc.constantVars[0].id : null,
    selectedToggleId: (doc.toggles && doc.toggles.length > 0) ? doc.toggles[0].id : null,
    selectedMeshId: pickBestMesh(doc.meshSections),
    selectedDrawCallId: null,
    meshMode: 'simple',
    deletedVarNames: new Set(),
    deletedToggleSections: new Set(),
    newSkipSections: [],
  };

  const initialMesh = state.meshSections.find(m => m.id === state.selectedMeshId);
  if (initialMesh && initialMesh.drawCalls && initialMesh.drawCalls[0]) {
    state.selectedDrawCallId = initialMesh.drawCalls[0].id;
    state.meshMode = detectConditionMode(initialMesh.drawCalls[0].condition);
  }

  // 공통 액션 객체
  const actions = {
    loadIniContent,
    saveIniContent,
    applyOrProposeIniChanges,
    onVarsChanged: () => {
      keysView?.updateDetail();
      meshView?.updateDetail();
    },
    onKeysChanged: () => {
      meshView?.updateDetail();
    },
  };

  // 상단 툴바 생성
  const toolbar = createToolbar({
    context,
    iniFiles,
    currentIniPath: state.currentIniPath,
    onSelectFile: async (newPath) => {
      state.currentIniPath = newPath;
      currentIniPath = newPath;
      context.logger?.info(`편집 대상 INI 문서 전환: ${newPath || '(열린 INI 문서)'}`);
      await reloadDocument();
      context.ui.showToast('파일을 불러왔습니다.', 'info');
    },
    onRefresh: async () => {
      context.logger?.info('INI 문서 목록 및 내용 새로고침');
      iniFiles = await scanIniFiles(context);
      toolbar.updateFileList(iniFiles, state.currentIniPath);
      await reloadDocument();
      context.ui.showToast('문서 목록을 갱신했습니다.', 'info');
    },
    onSyncAll: async () => {
      if (!state.currentIniPath && (!state.meshSections || state.meshSections.length === 0)) {
        context.ui.showToast('적용할 INI 파일이나 메쉬 정보가 없습니다.', 'warn');
        return;
      }
      let currentFull = await loadIniContent();

      // 1. 삭제 대기 중인 토글 키 섹션 제거
      if (state.deletedToggleSections && state.deletedToggleSections.size > 0) {
        for (const sec of state.deletedToggleSections) {
          currentFull = removeSectionFromText(currentFull, sec);
        }
      }

      // 2. 삭제 대기 중인 변수 선언 제거
      if (state.deletedVarNames && state.deletedVarNames.size > 0) {
        for (const vn of state.deletedVarNames) {
          currentFull = removeConstantVariable(currentFull, vn);
        }
      }

      // 3. 신규 추가된 스킵 섹션 주입
      if (state.newSkipSections && state.newSkipSections.length > 0) {
        for (const skip of state.newSkipSections) {
          currentFull = injectSectionProps(currentFull, skip.sectionName, { hash: skip.hash });
        }
      }

      // 4. [Constants] 변수들 동기화
      state.constantVars.forEach(v => {
        currentFull = upsertConstantVariable(currentFull, v.name, v.defaultValue || '0', v.isPersist);
      });

      // 5. [Key...] 토글 섹션들 동기화
      state.toggles.forEach(t => {
        const props = {
          key: t.key || 'no_modifiers VK_UP',
          type: t.type || 'cycle',
          condition: '$active == 1',
        };
        if (t.isCustomVar && t.customVarLine !== undefined) {
          const trimmedLine = t.customVarLine.trim();
          const eqIdx = trimmedLine.indexOf('=');
          if (eqIdx !== -1) {
            const k = trimmedLine.slice(0, eqIdx).trim();
            const v = trimmedLine.slice(eqIdx + 1).trim();
            if (k) {
              props[k] = v;
              if (k.startsWith('$')) {
                currentFull = ensureConstantVariable(currentFull, k, 0);
              }
            }
          } else if (trimmedLine) {
            props[trimmedLine] = '0, 1';
            if (trimmedLine.startsWith('$')) {
              currentFull = ensureConstantVariable(currentFull, trimmedLine, 0);
            }
          }
        } else if (t.variableName) {
          const statesStr = Array.isArray(t.states) ? t.states.join(', ') : t.states;
          props[t.variableName] = statesStr;
          currentFull = ensureConstantVariable(currentFull, t.variableName, 0);
        }
        currentFull = injectSectionProps(currentFull, t.sectionName, props);
      });

      // 6. 메쉬 섹션별 drawindexed / TTL / handling = skip 조건문 동기화
      state.meshSections.forEach(m => {
        if (m.drawCalls && m.drawCalls.length > 0) {
          currentFull = injectDrawIndexedConditions(currentFull, m.sectionName, m.drawCalls);
        }
      });

      // 7. 토글 키가 존재할 때만 $active 파이프라인 자동 보장 (잔여 토글이 전혀 없으면 정리)
      const hasAnyToggle = (state.toggles && state.toggles.length > 0) || /^\[Key/im.test(currentFull);
      if (state.toggles && state.toggles.length > 0) {
        currentFull = ensureActivePipeline(currentFull);
      } else if (!hasAnyToggle) {
        currentFull = removeActivePipeline(currentFull);
      }

      // 8. [Present], [Constants] 섹션에 내용이 안 남았으면 섹션도 함께 삭제
      currentFull = removeEmptySection(currentFull, 'Present');
      currentFull = removeEmptySection(currentFull, 'Presents');
      currentFull = removeEmptySection(currentFull, 'Constants');

      await applyOrProposeIniChanges(currentFull, {
        title: 'INI 전체 설정 적용 제안',
        description: '변수, 토글 키, 메쉬 조건문 및 $active 파이프라인 변경 사항을 인라인으로 검토하세요.',
        onAccepted: () => {
          if (state.deletedVarNames) state.deletedVarNames.clear();
          if (state.deletedToggleSections) state.deletedToggleSections.clear();
          state.newSkipSections = [];
          context.ui.showToast('전체 변경 사항이 성공적으로 저장되었습니다.', 'success');
        },
      });
    },
  });

  // 서브 뷰 생성
  const varsView = createVarsView({ context, state, actions });
  const keysView = createKeysView({ context, state, actions });
  const meshView = createMeshView({ context, state, actions });

  // 3대 탭 네비게이션 생성 (변수 설정, 키 설정, 조건문 설정)
  const tabsNav = context.ui.createTabs({
    tabs: [
      { id: 'vars', label: '변수 설정', content: varsView.container },
      { id: 'keys', label: '키 설정', content: keysView.container },
      { id: 'mesh', label: '조건문 설정', content: meshView.container },
    ],
    defaultTab: 'vars',
  });

  if (tabsNav.container) {
    tabsNav.container.style.cssText += '; flex: 1 1 0; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden;';
  }

  const mainLayout = context.ui.createColumn({
    gap: 10,
    align: 'stretch',
    children: [
      toolbar.element,
      tabsNav.container || toElement(tabsNav),
    ].filter(Boolean),
  });

  const mainLayoutEl = toElement(mainLayout) || mainLayout;
  mainLayoutEl.style.cssText += '; flex: 1 1 0; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden;';
  container.appendChild(mainLayoutEl);

  /**
   * 모드 폴더 닫힘 또는 탭 종료 시 작업 메모리를 완전히 비워 초기화합니다.
   */
  function resetStateAndMemory() {
    currentIniPath = null;
    state.currentIniPath = null;
    state.toggles = [];
    state.constants = {};
    state.constantVars = [];
    state.meshSections = [];
    state.selectedVarId = null;
    state.selectedToggleId = null;
    state.selectedMeshId = null;
    state.selectedDrawCallId = null;
    state.meshMode = 'simple';
    state.deletedVarNames = new Set();
    state.deletedToggleSections = new Set();
    state.newSkipSections = [];
    rawIni = '';
    doc = { toggles: [], constants: {}, constantVars: [], meshSections: [] };
    iniFiles = [];

    toolbar.updateFileList([], null);
    varsView.updateList();
    varsView.updateDetail();
    keysView.updateList();
    keysView.updateDetail();
    meshView.renderSectionSelector();
    meshView.updateList();
    meshView.updateDetail();
  }

  async function reloadDocument(preserveSelection = false) {
    if (!state.currentIniPath && !context.workspace?.getCurrentFolder?.()) {
      resetStateAndMemory();
      return;
    }

    const prevVarId = state.selectedVarId;
    const prevToggleId = state.selectedToggleId;
    const prevMeshId = state.selectedMeshId;
    const prevCallId = state.selectedDrawCallId;

    rawIni = await loadIniContent();
    doc = parseIniDocument(rawIni);
    state.toggles = doc.toggles;
    state.constants = doc.constants;
    state.constantVars = doc.constantVars || [];
    state.meshSections = doc.meshSections;
    state.deletedVarNames = new Set();
    state.deletedToggleSections = new Set();
    state.newSkipSections = [];

    if (preserveSelection && state.constantVars.some(v => v.id === prevVarId)) {
      state.selectedVarId = prevVarId;
    } else {
      state.selectedVarId = state.constantVars.length > 0 ? state.constantVars[0].id : null;
    }

    if (preserveSelection && state.toggles.some(t => t.id === prevToggleId)) {
      state.selectedToggleId = prevToggleId;
    } else {
      state.selectedToggleId = state.toggles.length > 0 ? state.toggles[0].id : null;
    }

    if (preserveSelection && state.meshSections.some(m => m.id === prevMeshId)) {
      state.selectedMeshId = prevMeshId;
    } else {
      state.selectedMeshId = pickBestMesh(state.meshSections);
    }

    const curReloadMesh = state.meshSections.find(m => m.id === state.selectedMeshId);
    if (curReloadMesh && curReloadMesh.drawCalls && curReloadMesh.drawCalls.length > 0) {
      if (preserveSelection && curReloadMesh.drawCalls.some(c => c.id === prevCallId)) {
        state.selectedDrawCallId = prevCallId;
      } else {
        state.selectedDrawCallId = curReloadMesh.drawCalls[0].id;
      }
    } else {
      state.selectedDrawCallId = null;
    }

    const curCall = curReloadMesh?.drawCalls?.find(c => c.id === state.selectedDrawCallId);
    if (curCall) {
      state.meshMode = detectConditionMode(curCall.condition);
    }

    varsView.updateList();
    varsView.updateDetail();
    keysView.updateList();
    keysView.updateDetail();
    meshView.renderSectionSelector();
    meshView.updateList();
    meshView.updateDetail();

    context.logger?.info(`INI 문서 로드 완료 (${state.currentIniPath ? state.currentIniPath.split(/[\\/]/).pop() : '현재 활성 문서'}): 변수 ${state.constantVars.length}개, 토글 ${state.toggles.length}개, 메쉬 섹션 ${state.meshSections.length}개`);
  }

  // 워크스페이스 이벤트 리스너 목록 (클린업용)
  const unlisteners = [];

  // 1) 워크스페이스 메모리 해제 이벤트 연동 (모드 폴더 닫기/변경/리셋 시 발생)
  if (typeof context.workspace?.onDidClearMemory === 'function') {
    const unlistenClear = context.workspace.onDidClearMemory(({ reason }) => {
      context.logger?.info(`워크스페이스 메모리 해제 이벤트 수신 (이유: ${reason}): 토글 매니저 작업 메모리 소거`);
      resetStateAndMemory();
      if (reason === 'folder_closed') {
        context.ui.showToast('모드 폴더가 닫혀 작업 메모리가 초기화되었습니다.', 'info');
      }
    });
    unlisteners.push(unlistenClear);
  }

  // 2) 모드 작업 폴더 변경(열림 또는 닫힘) 실시간 감지
  if (typeof context.workspace?.onDidChangeActiveFolder === 'function') {
    const unlistenFolder = context.workspace.onDidChangeActiveFolder(async (folderPath) => {
      if (!folderPath) {
        context.logger?.info('모드 폴더 닫힘 감지: 토글 매니저 작업 메모리 및 상태 초기화');
        resetStateAndMemory();
      } else {
        context.logger?.info(`새 모드 폴더 열림 감지 (${folderPath}): INI 목록 재스캔`);
        iniFiles = await scanIniFiles(context);
        state.currentIniPath = iniFiles.length > 0 ? iniFiles[0].path : null;
        currentIniPath = state.currentIniPath;
        toolbar.updateFileList(iniFiles, state.currentIniPath);
        await reloadDocument();
      }
    });
    unlisteners.push(unlistenFolder);
  }

  // 3) 파일 저장 완료 감지 (에디터 Ctrl+S 저장 등 외부 변경 실시간 동기화)
  if (typeof context.workspace?.onDidSaveFile === 'function') {
    const unlistenSave = context.workspace.onDidSaveFile(async ({ path, name }) => {
      if (!path) return;
      const normalize = (p) => p.replace(/\\/g, '/').toLowerCase();
      const currentNorm = state.currentIniPath ? normalize(state.currentIniPath) : '';
      const savedNorm = normalize(path);

      if (currentNorm && currentNorm === savedNorm) {
        context.logger?.info(`현재 편집 중인 INI 파일 저장 감지: [${name}] 토글 매니저 내용 자동 동기화`);
        await reloadDocument(true);
      } else if (savedNorm.endsWith('.ini')) {
        // 다른 ini 파일이 새로 저장되었을 수 있으므로 파일 목록 새로고침
        iniFiles = await scanIniFiles(context);
        toolbar.updateFileList(iniFiles, state.currentIniPath);
      }
    });
    unlisteners.push(unlistenSave);
  }

  // 최초 렌더링
  if (hasInitialFolder || currentIniPath) {
    varsView.updateList();
    varsView.updateDetail();
    keysView.updateList();
    keysView.updateDetail();
    meshView.renderSectionSelector();
    meshView.updateList();
    meshView.updateDetail();
  } else {
    resetStateAndMemory();
  }

  // 탭 닫힘 또는 cleanup 호출 시 모든 리스너 해제 및 메모리 완전 소거
  return () => {
    while (unlisteners.length > 0) {
      const fn = unlisteners.pop();
      try { fn(); } catch { }
    }
    resetStateAndMemory();
    context.logger?.debug('토글 매니저 탭 닫힘: 모든 이벤트 리스너 및 탭 내부 메모리가 정리되었습니다.');
  };
}

/**
 * 에디터 탭을 여는 헬퍼 함수
 */
export function openManagerTab(context) {
  context.logger?.debug('토글 & 메쉬 매니저 탭을 열었습니다.');
  context.ui.openTab({
    id: 'toggle-manager-main-tab',
    title: '토글 & 메쉬 매니저',
    icon: '🕹️️',
    render(container) {
      return renderToggleManagerTab(container, context);
    },
  });
}
