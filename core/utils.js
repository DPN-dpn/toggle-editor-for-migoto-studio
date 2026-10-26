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

/**
 * ; Constants ------------------------- 주석 라인의 인덱스를 찾습니다.
 */
export function findConstantsCommentLineIndex(lines) {
  if (!Array.isArray(lines)) return -1;
  const commentRegex = /^\s*;\s*-*\s*\[?\s*Constants\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (commentRegex.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * 특정 섹션의 끝 라인 인덱스(다음 섹션 시작 전 또는 후행 빈 라인 정리 위치)를 반환합니다.
 */
export function findSectionEndIndex(lines, secStartIdx) {
  if (!Array.isArray(lines) || secStartIdx < 0) return lines ? lines.length : 0;
  let end = lines.length;
  for (let i = secStartIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().match(/^\[(.*?)\]$/)) {
      end = i;
      break;
    }
  }
  while (end > secStartIdx + 1 && !lines[end - 1].trim()) {
    end--;
  }
  return end;
}

/**
 * 지정된 섹션에 유효한 설정/변수 구문이 없으면 해당 섹션(헤더 및 빈 줄)을 삭제합니다.
 */
export function removeEmptySection(fullText, sectionName) {
  if (!fullText || typeof fullText !== 'string' || !sectionName) return fullText;
  const lines = fullText.split(/\r?\n/);
  let startIdx = -1;
  let nextSecIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^\[(.*?)\]$/);
    if (match) {
      if (match[1].trim().toLowerCase() === sectionName.toLowerCase()) {
        startIdx = i;
      } else if (startIdx !== -1) {
        nextSecIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) return fullText;

  // startIdx + 1 부터 nextSecIdx 직전까지 실제 유효한 프로퍼티(할당 구문 등)가 있는지 검사
  // 주석이나 공백 라인은 유효 내용으로 치지 않음
  let hasContent = false;
  for (let i = startIdx + 1; i < nextSecIdx; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
      hasContent = true;
      break;
    }
  }

  if (hasContent) {
    return fullText; // 내용이 남아있으므로 삭제하지 않음
  }

  // 내용이 없으므로 startIdx(헤더)부터 빈 라인 정리하여 삭제
  let deleteEndIdx = startIdx + 1;
  while (deleteEndIdx < nextSecIdx && !lines[deleteEndIdx].trim()) {
    deleteEndIdx++;
  }

  let deleteStartIdx = startIdx;
  if (deleteStartIdx > 0 && !lines[deleteStartIdx - 1].trim() && deleteEndIdx < lines.length && !lines[deleteEndIdx].trim()) {
    deleteEndIdx++;
  }

  lines.splice(deleteStartIdx, deleteEndIdx - deleteStartIdx);
  return lines.join('\n');
}
