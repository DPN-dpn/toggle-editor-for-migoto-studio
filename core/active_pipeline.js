/**
 * core/active_pipeline.js
 * 3DMigoto/XXMI $active 변수 파이프라인 자동화 모듈
 * 1. [Constants] 섹션에 global $active = 0 선언 보장
 * 2. [Present] 섹션에 post $active = 0 프레임 리셋 구문 보장
 * 3. vb2 = 가 있는 첫 번째 Blend 섹션 끝에 $active = 1 활성화 구문 보장
 */

/**
 * $active 변수 파이프라인을 검사하고 누락된 구문을 자동 주입합니다.
 * @param {string} fullText - INI 문서 전체 텍스트
 * @returns {string} $active 파이프라인이 보장된 INI 문서 텍스트
 */
export function ensureActivePipeline(fullText) {
  if (!fullText || typeof fullText !== 'string') return fullText;
  let text = fullText;

  // 1. [Constants]에 $active 선언 확인 (global $active = 0 등)
  const activeConstRegex = /^\s*(?:global\s+(?:persist\s+)?)?\$active\s*=/mi;
  if (!activeConstRegex.test(text)) {
    const constHeaderRegex = /^\[Constants\]/im;
    const match = constHeaderRegex.exec(text);
    if (match) {
      const insertPos = match.index + match[0].length;
      text = text.slice(0, insertPos) + '\nglobal $active = 0' + text.slice(insertPos);
    } else {
      text = `[Constants]\nglobal $active = 0\n\n` + text;
    }
  }

  // 2. [Present] 섹션 및 post $active = 0 확인
  const postActiveRegex = /^\s*post\s+\$active\s*=\s*0\b/mi;
  if (!postActiveRegex.test(text)) {
    const presentRegex = /^\[Present\]/im;
    const matchPresent = presentRegex.exec(text);
    if (matchPresent) {
      const insertPos = matchPresent.index + matchPresent[0].length;
      text = text.slice(0, insertPos) + '\npost $active = 0' + text.slice(insertPos);
    } else {
      const nextSecRegex = /^\[(?:Key|TextureOverride)/im;
      const matchNextSec = nextSecRegex.exec(text);
      if (matchNextSec) {
        text = text.slice(0, matchNextSec.index) + `[Present]\npost $active = 0\n\n` + text.slice(matchNextSec.index);
      } else {
        text += `\n\n[Present]\npost $active = 0\n`;
      }
    }
  }

  // 3. Blend 섹션(vb2 = 구문이 있는 곳)에 $active = 1 활성화 구문 확인
  const activeSetRegex = /^\s*\$active\s*=\s*1\b/mi;
  if (!activeSetRegex.test(text)) {
    const lines = text.split(/\r?\n/);
    let targetSectionStart = -1;
    let targetSectionEnd = lines.length;
    let foundSection = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('[') && trimmed.includes(']')) {
        if (foundSection) {
          targetSectionEnd = i;
          break;
        }
        targetSectionStart = i;
      } else if (targetSectionStart !== -1 && /^vb2\s*=/i.test(trimmed)) {
        foundSection = true;
      }
    }

    if (foundSection && targetSectionStart !== -1) {
      let insertLineIdx = targetSectionEnd;
      while (insertLineIdx > targetSectionStart + 1 && !lines[insertLineIdx - 1].trim()) {
        insertLineIdx--;
      }
      lines.splice(insertLineIdx, 0, '$active = 1');
      text = lines.join('\n');
    }
  }

  return text;
}
