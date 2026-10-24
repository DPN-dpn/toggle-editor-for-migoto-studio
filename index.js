/**
 * XXMI 토글 & 메쉬 매니저 (Migoto Studio 공식 플러그인 엔트리)
 */
import { openManagerTab } from './ui.js';

export default {
  activate(context) {
    context.logger?.info('토글 & 메쉬 매니저 플러그인이 로드되었습니다.');

    context.ui.registerMenuItem({
      label: 'XXMI 토글 & 메쉬 매니저 열기…',
      action: () => {
        context.logger?.debug('메뉴를 통해 토글 & 메쉬 매니저 탭을 열었습니다.');
        openManagerTab(context);
      },
    });

    // 워크스페이스 메모리 해제 전역 알림 수신
    if (typeof context.workspace?.onDidClearMemory === 'function') {
      context.workspace.onDidClearMemory(({ reason }) => {
        context.logger?.info(`[Workspace] 메모리 초기화 알림 수신 (이유: ${reason})`);
      });
    }

    context.ui.showToast('XXMI 토글 매니저 플러그인이 로드되었습니다.', 'info');
  },

  deactivate(context) {
    context?.logger?.info('토글 & 메쉬 매니저 플러그인이 비활성화되었습니다.');
  },
};
