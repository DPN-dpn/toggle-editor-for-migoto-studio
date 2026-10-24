/**
 * components/toolbar.js
 * 상단 INI 파일 선택 드롭다운, 새로고침 및 전체 적용 툴바 컴포넌트
 */
import { toElement } from '../core/utils.js';

function toOptions(iniFiles, hasFolder = true) {
  const opts = (iniFiles || []).map(f => ({ value: f.path, label: f.name }));
  if (opts.length > 0) return opts;
  return [{ value: '', label: hasFolder ? '(열린 INI 문서)' : '(열린 모드 폴더 없음)' }];
}

export function createToolbar({ context, iniFiles, currentIniPath, onSelectFile, onRefresh, onSyncAll }) {
  const hasFolder = Boolean(context?.workspace?.getCurrentFolder?.());
  const fileOptions = toOptions(iniFiles, hasFolder);

  const fileSelect = context.ui.createSelect({
    label: '편집 대상 INI',
    options: fileOptions,
    value: currentIniPath || fileOptions[0].value,
    onChange: async (newPath) => {
      if (typeof onSelectFile === 'function') await onSelectFile(newPath);
    },
  });

  const btnRefresh = context.ui.createIconButton({
    icon: 'refresh',
    title: '문서 새로고침',
    variant: 'secondary',
    onClick: async () => {
      if (typeof onRefresh === 'function') await onRefresh();
    },
  });

  const btnSyncAll = context.ui.createButton({
    text: '적용',
    variant: 'primary',
    onClick: async () => {
      if (typeof onSyncAll === 'function') await onSyncAll();
    },
  });

  const fileSelectEl = toElement(fileSelect);
  if (fileSelectEl?.style) {
    fileSelectEl.style.flex = '1 1 auto';
    fileSelectEl.style.minWidth = '0';
  }

  const btnRow = context.ui.createRow({
    gap: 8,
    align: 'center',
    children: [btnRefresh, btnSyncAll],
  });
  const btnRowEl = toElement(btnRow);
  if (btnRowEl?.style) {
    btnRowEl.style.flexShrink = '0';
    btnRowEl.style.whiteSpace = 'nowrap';
  }

  const topToolbar = context.ui.createRow({
    gap: 10,
    align: 'center',
    justify: 'space-between',
    children: [fileSelect, btnRow],
  });

  function updateFileList(newIniFiles, selectedPath) {
    const currentHasFolder = Boolean(context?.workspace?.getCurrentFolder?.());
    fileSelect.setOptions?.(toOptions(newIniFiles, currentHasFolder));
    if (selectedPath) {
      fileSelect.setValue?.(selectedPath);
    } else {
      fileSelect.setValue?.('');
    }
  }

  return {
    element: toElement(topToolbar) || topToolbar,
    updateFileList,
  };
}
