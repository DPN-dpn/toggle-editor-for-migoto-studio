/**
 * components/skip_modal.js
 * 해시 스킵(지우기) 섹션 추가 대화상자 (context.ui.createModal 기반)
 */
export function openAddHashSkipModal({ context, meshSections, onConfirm }) {
  const inputHash = context.ui.createInput({
    label: '해시값 (hash)',
    placeholder: '예: 09c39441',
    description: '스킵할 메쉬의 8자리 16진수 해시값을 입력하세요.',
  });

  const inputSecName = context.ui.createInput({
    label: '섹션 이름',
    value: 'TextureOverride',
    placeholder: '예: TextureOverrideHat',
    description: '비워두면 해시값 기반으로 자동 생성됩니다.',
  });

  const form = context.ui.createColumn({
    gap: 12,
    children: [inputHash, inputSecName],
  });

  let modal = null;

  const btnCancel = context.ui.createButton({
    text: '취소',
    variant: 'secondary',
    onClick: () => modal.close(),
  });

  const btnConfirm = context.ui.createButton({
    text: '섹션 생성 및 등록',
    variant: 'primary',
    onClick: async () => {
      const rawHash = (inputHash.getValue ? inputHash.getValue() : '').trim();
      if (!rawHash) {
        inputHash.setError?.('해시값을 입력해야 합니다.');
        return;
      }

      let rawSec = (inputSecName.getValue ? inputSecName.getValue() : '').trim();
      if (!rawSec || rawSec.toLowerCase() === 'textureoverride') {
        rawSec = `TextureOverride${rawHash}`;
      }
      if (!rawSec.toLowerCase().startsWith('textureoverride')) {
        rawSec = `TextureOverride${rawSec}`;
      }

      const conflict = (meshSections || []).some(m => m.sectionName.toLowerCase() === rawSec.toLowerCase());
      if (conflict) {
        inputSecName.setError?.('이미 존재하는 섹션 이름입니다.');
        return;
      }

      modal.close();

      if (typeof onConfirm === 'function') {
        await onConfirm({ sectionName: rawSec, hash: rawHash });
      }
    },
  });

  modal = context.ui.createModal({
    title: '해시 스킵(지우기) 섹션 추가',
    description: '특정 악세서리나 부위를 지우기(스킵) 위한 [TextureOverride...] 섹션과 해시값을 등록합니다. 등록 후 우측에서 토글 조건을 설정할 수 있습니다.',
    width: 'small',
    closeOnBackdrop: true,
    closeOnEsc: true,
    content: form,
    actions: [btnCancel, btnConfirm],
  });

  modal.open();
}
