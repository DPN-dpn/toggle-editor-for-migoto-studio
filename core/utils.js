/**
 * core/utils.js
 * 토글 & 메쉬 매니저 공통 유틸리티 헬퍼 함수 모음
 */

/**
 * DOM 노드를 안전하게 추출하는 헬퍼 함수
 */
export function toElement(widget) {
  if (!widget) return null;
  if (widget instanceof HTMLElement) return widget;
  if (typeof widget.getElement === 'function') return widget.getElement();
  if (widget.element instanceof HTMLElement) return widget.element;
  if (widget.container instanceof HTMLElement) return widget.container;
  return null;
}

/**
 * INI 섹션명에서 UI용 이름 추출 (Key 접두사 제거)
 * 예: KeyToggleDress -> ToggleDress
 */
export function getSectionDisplayName(sectionName) {
  if (!sectionName) return '';
  return sectionName.replace(/^Key/i, '');
}

/**
 * UI에서 입력된 이름을 실제 INI 섹션명으로 변환 (Key 접두사 자동 보장)
 * 예: ToggleDress -> KeyToggleDress
 */
export function getFullSectionName(inputName) {
  const trimmed = (inputName || '').trim();
  if (!trimmed) return 'KeyToggle';
  if (trimmed.toLowerCase().startsWith('key')) {
    return 'Key' + trimmed.slice(3);
  }
  return 'Key' + trimmed;
}

/**
 * $를 뺀 순수 변수명 (UI 표시 및 입력용)
 * 예: $dress -> dress
 */
export function getVarDisplayName(varName) {
  if (!varName) return '';
  return varName.startsWith('$') ? varName.slice(1) : varName;
}

/**
 * 조건식 문자열을 분석하여 UI 모드(단순, 어드밴스드, 직접 입력)를 판별합니다.
 */
export function detectConditionMode(cond) {
  if (!cond || !cond.trim()) return 'simple';
  const trimmed = cond.trim();

  // 단일 변수의 단순 OR 조건식인 경우 단순 모드
  // 예: $active == 1, $dress == 1 || $dress == 2
  const varMatches = [...trimmed.matchAll(/\$([a-zA-Z0-9_]+)/g)].map(m => m[1]);
  const uniqueVars = new Set(varMatches);

  if (uniqueVars.size === 1) {
    if (!trimmed.includes('&&') && !trimmed.includes('>') && !trimmed.includes('<') && !trimmed.includes('!')) {
      return 'simple';
    }
  }

  // 여러 변수가 AND/OR로 결합된 기본 패턴
  // 예: $active == 1 && $dress == 2
  if (/^(\$[a-zA-Z0-9_]+\s*==\s*\d+\s*(&&|\|\|)\s*)*\$[a-zA-Z0-9_]+\s*==\s*\d+$/.test(trimmed)) {
    return 'advanced';
  }

  // 그 외 시스템 변수(DRAW_TYPE 등)나 부등호가 들어간 복잡한 식은 직접 입력
  return 'custom';
}

/**
 * 주어진 텍스트가 유효한 INI 라인인지(공백이나 순수 주석이 아닌지) 검사
 */
export function isContentLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith(';') && !trimmed.startsWith('#');
}

/**
 * 보조 파이프라인 섹션(Blend, Texcoord, Position, LimitRaise 등)인지 판별
 * 해당 섹션들은 토글 대상 메쉬 목록에서 제외합니다.
 */
export function isAuxiliaryPipelineSection(sectionName, props = {}) {
  if (!sectionName) return false;
  const name = sectionName.toLowerCase();

  // 1. 이름 기반 필터링
  if (
    name.endsWith('blend') ||
    name.endsWith('texcoord') ||
    name.endsWith('vertexlimitraise') ||
    name.endsWith('position') ||
    name.includes('limitraise')
  ) {
    return true;
  }

  // 2. 속성 기반 필터링
  if (props['draw'] && !props['drawindexed']) {
    return true;
  }

  return false;
}

/**
 * 프로젝트 내의 모든 .ini 파일 목록을 검색합니다.
 */
export async function scanIniFiles(context) {
  try {
    const files = await context.workspace.readDirectory();
    return files
      .filter(f => f.name.toLowerCase().endsWith('.ini'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    context.logger?.warn('scanIniFiles error:', err);
    return [];
  }
}
