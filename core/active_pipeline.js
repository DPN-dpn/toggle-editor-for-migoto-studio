/**
 * core/active_pipeline.js
 * 3DMigoto/XXMI $active 변수 파이프라인 자동화 모듈
 * 1. [Constants] 섹션에 global $active = 0 선언 보장
 * 2. [Present] 섹션에 post $active = 0 프레임 리셋 구문 보장
 * 3. vb2 = 가 있는 첫 번째 Blend 섹션 끝에 $active = 1 활성화 구문 보장
 */

import { findConstantsCommentLineIndex, findSectionEndIndex, removeEmptySection } from './utils.js';

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
      // [Constants] 섹션이 없을 때: ; Constants ------------------------- 주석 확인
      const lines = text.split(/\r?\n/);
      const commentIdx = findConstantsCommentLineIndex(lines);
      const newConstLines = ['[Constants]', 'global $active = 0'];

      if (commentIdx !== -1) {
        let insertIdx = commentIdx + 1;
        while (insertIdx < lines.length && /^\s*;\s*[-=~#*]{3,}\s*$/.test(lines[insertIdx])) {
          insertIdx++;
        }
        if (insertIdx < lines.length && lines[insertIdx].trim() === '') {
          insertIdx++;
        } else {
          newConstLines.unshift('');
        }
        newConstLines.push('');
        lines.splice(insertIdx, 0, ...newConstLines);
        text = lines.join('\n');
      } else {
        text = `[Constants]\nglobal $active = 0\n\n` + text;
      }
    }
  }

  // 2. [Present] 섹션 및 post $active = 0 확인
  const postActiveRegex = /^\s*post\s+\$active\s*=\s*0\b/mi;
  if (!postActiveRegex.test(text)) {
    const presentRegex = /^\[Presents?\]/im;
    const matchPresent = presentRegex.exec(text);
    if (matchPresent) {
      const insertPos = matchPresent.index + matchPresent[0].length;
      text = text.slice(0, insertPos) + '\npost $active = 0' + text.slice(insertPos);
    } else {
      // [Present] 섹션이 없을 때:
      // 위치 우선순위:
      // A. 첫 번째 [Key...] 섹션 바로 앞
      // B. [Constants] 섹션 바로 뒤
      // C. ; Constants ------------------------- 주석 바로 뒤
      // D. 첫 번째 Override 섹션 앞 또는 파일 끝
      const lines = text.split(/\r?\n/);
      let keyIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\[Key/i.test(lines[i].trim())) {
          keyIdx = i;
          break;
        }
      }

      if (keyIdx !== -1) {
        lines.splice(keyIdx, 0, '[Present]', 'post $active = 0', '');
        text = lines.join('\n');
      } else {
        let constStart = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/^\[Constants\]/i.test(lines[i].trim())) {
            constStart = i;
            break;
          }
        }
        if (constStart !== -1) {
          const constEnd = findSectionEndIndex(lines, constStart);
          lines.splice(constEnd, 0, '', '[Present]', 'post $active = 0');
          text = lines.join('\n');
        } else {
          const commentIdx = findConstantsCommentLineIndex(lines);
          if (commentIdx !== -1) {
            let insertIdx = commentIdx + 1;
            while (insertIdx < lines.length && /^\s*;\s*[-=~#*]{3,}\s*$/.test(lines[insertIdx])) {
              insertIdx++;
            }
            const newPresent = ['[Present]', 'post $active = 0'];
            if (insertIdx < lines.length && lines[insertIdx].trim() === '') {
              insertIdx++;
            } else {
              newPresent.unshift('');
            }
            newPresent.push('');
            lines.splice(insertIdx, 0, ...newPresent);
            text = lines.join('\n');
          } else {
            const nextSecRegex = /^\[(?:TextureOverride|ShaderOverride)/im;
            const matchNextSec = nextSecRegex.exec(text);
            if (matchNextSec) {
              text = text.slice(0, matchNextSec.index) + `[Present]\npost $active = 0\n\n` + text.slice(matchNextSec.index);
            } else {
              text += `\n\n[Present]\npost $active = 0\n`;
            }
          }
        }
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

/**
 * $active 변수 파이프라인 구문들을 문서에서 제거합니다.
 * 토글 키가 모두 삭제되었을 때 호출되어 잔여 $active 선언 및 리셋 구문을 정리합니다.
 * @param {string} fullText - INI 문서 전체 텍스트
 * @returns {string} $active 구문이 정리된 INI 문서 텍스트
 */
export function removeActivePipeline(fullText) {
  if (!fullText || typeof fullText !== 'string') return fullText;

  const lines = fullText.split(/\r?\n/);
  const activeConstRegex = /^\s*(?:global\s+)?(?:persist\s+)?\$active\s*=/i;
  const postActiveRegex = /^\s*post\s+\$active\s*=/i;
  const activeSetRegex = /^\s*\$active\s*=\s*1\b/i;

  let currentSection = null;
  const filtered = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const secMatch = trimmed.match(/^\[(.*?)\]$/);
    if (secMatch) {
      currentSection = secMatch[1].trim().toLowerCase();
      filtered.push(raw);
      continue;
    }

    if (currentSection === 'constants' && activeConstRegex.test(trimmed)) {
      continue;
    }
    if ((currentSection === 'present' || currentSection === 'presents') && postActiveRegex.test(trimmed)) {
      continue;
    }
    if (activeSetRegex.test(trimmed)) {
      continue;
    }

    filtered.push(raw);
  }

  let result = filtered.join('\n');
  result = removeEmptySection(result, 'Present');
  result = removeEmptySection(result, 'Presents');
  result = removeEmptySection(result, 'Constants');
  return result;
}

