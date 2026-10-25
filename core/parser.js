/**
 * XXMI 토글 & 메쉬 매니저 - INI 파서 및 조건문 생성 엔진 (Core 모듈)
 * 3DMigoto/XXMI 특화: 다중 drawindexed 분할 섹션, if-endif 제어 블록, 주석 및 헤더 무손실 보존
 */
import { isContentLine, isAuxiliaryPipelineSection, toElement, findConstantsCommentLineIndex, findSectionEndIndex } from './utils.js';
import { ensureActivePipeline } from './active_pipeline.js';
import * as ttl from './ttl.js';

export { toElement, ensureActivePipeline, ttl };

/**
 * INI 텍스트에서 토글 섹션([Key...]), [Constants] 변수, 메쉬 오버라이드 섹션을 파싱합니다.
 */
export function parseIniDocument(iniText) {
  if (!iniText || typeof iniText !== 'string') {
    return { toggles: [], constants: {}, constantVars: [], meshSections: [] };
  }

  const lines = iniText.split(/\r?\n/);
  const toggles = [];
  const constants = {};
  const constantVars = [];
  const meshSections = [];

  let currentSection = null;
  let currentComments = [];
  let currentLines = [];
  let currentProps = {};

  // 1단계: 전체 라인을 스캔하며 모든 drawindexed / handling = skip / TTL 구문과 그 직전 주석, 조건문 컨텍스트 수집
  const allSectionNames = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const secMatch = trimmed.match(/^\[\s*([^\]]+)\s*\](?:\s*[;#].*)?$/);
    if (secMatch) {
      allSectionNames.push(secMatch[1].trim());
    }
  }

  const allDrawCalls = [];
  let scanSection = null;
  let scanCondition = null; // 현재 if/elif 조건식 (null이면 상시 렌더링)
  let scanPendingComments = [];
  let scanPreIfComments = [];
  let scanMatchFirstIndex = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // 섹션 헤더 감지
    const secMatch = trimmed.match(/^\[\s*([^\]]+)\s*\](?:\s*[;#].*)?$/);
    if (secMatch) {
      scanSection = secMatch[1].trim();
      scanCondition = null;
      scanPendingComments = [];
      scanPreIfComments = [];
      scanMatchFirstIndex = null;
      continue;
    }

    // 주석 라인 수집
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^[;#]\s?/, '');
      scanPendingComments.push(commentText);
      continue;
    }

    // 조건문 블록 추적
    const ifMatch = trimmed.match(/^if\s+(.*?)(?:\s*[;#].*)?$/i);
    const elseIfMatch = trimmed.match(/^(?:else\s+if|elif)\s+(.*?)(?:\s*[;#].*)?$/i);
    const elseMatch = trimmed.match(/^else(?:\s*[;#].*)?$/i);
    const endifMatch = trimmed.match(/^endif(?:\s*[;#].*)?$/i);
    const mfiMatch = trimmed.match(/^match_first_index\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
    const drawMatch = trimmed.match(/^drawindexed\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
    const skipMatch = trimmed.match(/^handling\s*=\s*skip\b/i);

    if (mfiMatch) {
      scanMatchFirstIndex = mfiMatch[1].trim();
    } else if (ifMatch) {
      scanCondition = ifMatch[1].trim();
      if (scanPendingComments.length > 0) {
        scanPreIfComments = [...scanPendingComments];
      }
      scanPendingComments = [];
    } else if (elseIfMatch) {
      scanCondition = elseIfMatch[1].trim();
      scanPendingComments = [];
    } else if (elseMatch) {
      scanCondition = 'else';
      scanPendingComments = [];
    } else if (endifMatch) {
      scanCondition = null;
      scanPendingComments = [];
      scanPreIfComments = [];
    } else if (drawMatch) {
      // drawindexed 발견!
      const rawDrawVal = drawMatch[1] ? drawMatch[1].trim() : 'auto';
      const drawVal = rawDrawVal || 'auto';

      let commentList = scanPendingComments.length > 0 ? scanPendingComments : scanPreIfComments;
      let commentText = commentList.join('\n').trim();

      let callName = '';
      if (commentList.length > 0) {
        callName = commentList[commentList.length - 1].trim();
      } else if (scanMatchFirstIndex !== null) {
        callName = `파트 (Index: ${scanMatchFirstIndex})`;
      } else {
        callName = `drawindexed = ${drawVal}`;
      }

      allDrawCalls.push({
        id: `draw_${allDrawCalls.length}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        sectionName: scanSection || 'Global',
        name: callName,
        comment: commentText,
        value: drawVal,
        isSkip: false,
        matchFirstIndex: scanMatchFirstIndex,
        condition: scanCondition,
        lineIndex: i,
      });

      scanPendingComments = [];
      scanPreIfComments = [];
      scanMatchFirstIndex = null;
    } else if (skipMatch) {
      let commentList = scanPendingComments.length > 0 ? scanPendingComments : scanPreIfComments;
      let commentText = commentList.join('\n').trim();

      let callName = '';
      if (commentList.length > 0) {
        callName = commentList[commentList.length - 1].trim();
      } else if (scanMatchFirstIndex !== null) {
        callName = `스킵 파트 (Index: ${scanMatchFirstIndex})`;
      } else {
        callName = '메쉬 지우기 (스킵)';
      }

      allDrawCalls.push({
        id: `draw_${allDrawCalls.length}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        sectionName: scanSection || 'Global',
        name: callName,
        comment: commentText,
        value: 'handling = skip',
        isSkip: true,
        matchFirstIndex: scanMatchFirstIndex,
        condition: scanCondition,
        lineIndex: i,
      });

      scanPendingComments = [];
      scanPreIfComments = [];
      scanMatchFirstIndex = null;
    } else if (ttl.isTtlRunCommand(trimmed)) {
      // ZZMI TTL 드로우 구문 발견! (run = CommandList\TTL\Draw)
      const ttlCall = ttl.extractTtlBlock(lines, i, scanSection || 'Global', scanCondition);
      allDrawCalls.push(ttlCall);

      scanPendingComments = [];
      scanPreIfComments = [];
      scanMatchFirstIndex = null;
    } else {
      if (!scanCondition && trimmed.includes('=') && !ttl.isTtlProperty(trimmed)) {
        scanPendingComments = [];
        scanPreIfComments = [];
      }
    }
  }

  // 2단계: 섹션별 상세 파싱 및 drawCalls를 소속 섹션별로 그룹화
  const drawCallsBySection = new Map();
  for (const call of allDrawCalls) {
    const key = call.sectionName.toLowerCase();
    if (!drawCallsBySection.has(key)) {
      drawCallsBySection.set(key, []);
    }
    drawCallsBySection.get(key).push(call);
  }

  function flushCurrentSection() {
    if (!currentSection) return;

    const lowerName = currentSection.toLowerCase();

    if (lowerName === 'constants') {
      for (const line of currentLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^(?:(global(?:\s+persist)?)\s+)?(\$[\w\\]+)\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
        if (match) {
          const scope = match[1] ? match[1].toLowerCase() : '';
          const isPersist = scope.includes('persist');
          const varName = match[2];
          const defaultVal = match[3] !== undefined ? match[3].trim() : '0';
          constants[varName] = defaultVal;
          constantVars.push({
            id: `var_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            name: varName,
            defaultValue: defaultVal,
            isPersist: isPersist,
            states: ['0', '1'],
          });
        }
      }
      for (const [k, v] of Object.entries(currentProps)) {
        if (k.startsWith('$') && !constantVars.some(cv => cv.name.toLowerCase() === k.toLowerCase())) {
          constants[k] = v;
          constantVars.push({
            id: `var_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            name: k,
            defaultValue: v,
            isPersist: true,
            states: ['0', '1'],
          });
        }
      }
    } else if (lowerName.startsWith('key')) {
      const keyVal = currentProps['key'] || '';
      const typeVal = currentProps['type'] || 'cycle';
      const conditionVal = currentProps['condition'] || '';

      let varName = '';
      let states = [0, 1];
      const extraProps = {};

      for (const [propKey, propVal] of Object.entries(currentProps)) {
        if (propKey.startsWith('$')) {
          varName = propKey;
          const parsedStates = propVal.split(',').map(s => s.trim()).filter(Boolean);
          if (parsedStates.length > 0) {
            states = parsedStates;
          }
        } else if (!['key', 'type', 'condition'].includes(propKey.toLowerCase())) {
          extraProps[propKey] = propVal;
        }
      }

      toggles.push({
        id: `toggle_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        sectionName: currentSection,
        comment: currentComments.join('\n').trim(),
        key: keyVal,
        type: typeVal,
        condition: conditionVal,
        variableName: varName,
        states: states,
        extraProps: extraProps,
      });
    } else {
      let sectionDraws = drawCallsBySection.get(lowerName) || [];

      // 보조 파이프라인 섹션(Blend, Texcoord, Position, LimitRaise 등)은 토글 메쉬 대상에서 완전히 제외
      if (isAuxiliaryPipelineSection(currentSection, currentProps)) {
        currentSection = null;
        currentComments = [];
        currentProps = {};
        currentLines = [];
        return;
      }

      // 대상 섹션 판별:
      // 1. 메쉬 드로우 섹션 (Type 1): drawindexed = 구문이 존재하는 섹션 (대개 ib = 구문 동반)
      const hasDrawIndexed = sectionDraws.some(d => d.value !== 'handling = skip');

      // 2. 해시 스킵 섹션 (Type 2): hash = 구문이 있고, ib = 가 없으며, 실제로 handling = skip 구문이 명시된 섹션
      const hasHash = Boolean(currentProps['hash']);
      const hasNoIB = !currentProps['ib'];
      const hasExplicitSkip = sectionDraws.some(d => d.value === 'handling = skip') || currentProps['handling'] === 'skip';

      // 모드 적용전 베이스 스킵인지 판별 (대체용 ...IB, ...VB 섹션이 존재하는 경우)
      let isPreModSkip = false;
      if (!hasDrawIndexed && hasHash && hasExplicitSkip) {
        const hasCondition = sectionDraws.some(d => d.condition && d.condition.trim());
        if (!hasCondition) {
          const hasReplacement = allSectionNames.some(otherName => {
            const oLower = otherName.toLowerCase();
            if (oLower === lowerName) return false;
            return oLower.startsWith(lowerName) && (
              oLower.endsWith('ib') || 
              oLower.endsWith('vb') || 
              oLower.endsWith('draw') || 
              oLower.includes('limitraise')
            );
          });
          if (hasReplacement) isPreModSkip = true;
        }
      }

      if (hasDrawIndexed) {
        // 메쉬 드로우 섹션: 섹션 헤더에 적힌 무조건적 handling = skip은 헤더 속성으로 보존하고 drawCalls에서 제외
        const actualDrawCalls = sectionDraws.filter(d => d.value !== 'handling = skip');
        if (actualDrawCalls.length > 0) {
          meshSections.push({
            id: `mesh_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            sectionName: currentSection,
            comment: currentComments.join('\n').trim(),
            props: { ...currentProps },
            rawLines: [...currentLines],
            drawCalls: actualDrawCalls,
            isSkipSection: false,
          });
        }
      } else if (hasHash && hasNoIB && hasExplicitSkip && !isPreModSkip) {
        // 해시 스킵 섹션 (예: [TextureOverrideAcc], [TextureOverrideGlass])
        let skipCalls = sectionDraws.filter(d => d.value === 'handling = skip');
        const dispName = currentSection.replace(/^TextureOverride/i, '') || currentSection;
        if (skipCalls.length === 0) {
          skipCalls = [{
            id: `draw_skip_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            sectionName: currentSection,
            name: `${dispName} (스킵)`,
            comment: currentComments.join('\n').trim(),
            value: 'handling = skip',
            isSkip: true,
            condition: null,
          }];
        } else {
          skipCalls.forEach(sc => {
            if (!sc.comment && (!sc.name || sc.name.startsWith('drawindexed') || sc.name === '메쉬 지우기 (스킵)')) {
              sc.name = `${dispName} (스킵)`;
            }
          });
        }

        meshSections.push({
          id: `mesh_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          sectionName: currentSection,
          comment: currentComments.join('\n').trim(),
          props: { ...currentProps },
          rawLines: [...currentLines],
          drawCalls: skipCalls,
          isSkipSection: true,
        });
      }
    }

    currentSection = null;
    currentComments = [];
    currentProps = {};
    currentLines = [];
  }

  let lineCommentBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
      const cleanComment = trimmed.replace(/^[;#]\s?/, '');
      if (currentSection) {
        currentLines.push(raw);
      } else {
        lineCommentBuffer.push(cleanComment);
      }
      continue;
    }

    const secMatch = trimmed.match(/^\[\s*([^\]]+)\s*\](?:\s*[;#].*)?$/);
    if (secMatch) {
      flushCurrentSection();
      currentSection = secMatch[1].trim();
      currentComments = [...lineCommentBuffer];
      lineCommentBuffer = [];
      currentProps = {};
      currentLines = [raw];
      continue;
    }

    if (currentSection) {
      currentLines.push(raw);

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const propKey = trimmed.substring(0, eqIdx).trim();
        let propVal = trimmed.substring(eqIdx + 1).trim();

        // 후미 주석 제거
        const commentIdx = propVal.search(/\s+[;#]/);
        if (commentIdx !== -1) {
          propVal = propVal.substring(0, commentIdx).trim();
        }

        if (propKey) {
          currentProps[propKey] = propVal;
        }
      }
    }
  }

  flushCurrentSection();

  // toggles에 등록된 변수들의 states를 constantVars에 반영
  for (const t of toggles) {
    if (t.variableName) {
      const cv = constantVars.find(v => v.name.toLowerCase() === t.variableName.toLowerCase());
      if (cv && Array.isArray(t.states) && t.states.length > 0) {
        cv.states = [...t.states];
      }
    }
  }

  meshSections.sort((a, b) => (b.drawCalls ? b.drawCalls.length : 0) - (a.drawCalls ? a.drawCalls.length : 0));

  return { toggles, constants, constantVars, meshSections, allDrawCalls };
}

/**
 * 단일 토글 객체를 3DMigoto INI 섹션 코드로 변환합니다.
 */
export function buildToggleSnippet(toggle) {
  const lines = [];

  if (toggle.comment) {
    toggle.comment.split('\n').forEach(c => lines.push(`; ${c}`));
  }

  lines.push(`[${toggle.sectionName || 'KeyToggle'}]`);
  lines.push(`condition = ${toggle.condition || '$active == 1'}`);
  if (toggle.key) {
    lines.push(`key = ${toggle.key}`);
  }
  if (toggle.type) {
    lines.push(`type = ${toggle.type}`);
  }
  if (toggle.variableName) {
    const statesStr = Array.isArray(toggle.states) ? toggle.states.join(', ') : toggle.states;
    lines.push(`${toggle.variableName} = ${statesStr}`);
  }
  if (toggle.extraProps && typeof toggle.extraProps === 'object') {
    for (const [k, v] of Object.entries(toggle.extraProps)) {
      lines.push(`${k} = ${v}`);
    }
  }

  return lines.join('\n');
}

/**
 * 메쉬 섹션 내의 개별 drawindexed 호출마다 if-endif 조건 블록을 안전하게 주입/교체합니다.
 * 섹션 상단의 리소스/헤더 속성(hash, ib, Resource, run 등)은 100% 보존합니다.
 */
export function injectDrawIndexedConditions(fullText, sectionName, drawCalls) {
  const lines = fullText.split(/\r?\n/);
  let targetStartIdx = -1;
  let targetEndIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^\[(.*?)\](?:\s*[;#].*)?$/);
    if (match) {
      if (match[1].trim().toLowerCase() === sectionName.toLowerCase()) {
        targetStartIdx = i;
      } else if (targetStartIdx !== -1) {
        targetEndIdx = i;
        break;
      }
    }
  }

  if (targetStartIdx === -1) return fullText;

  const sectionLines = lines.slice(targetStartIdx, targetEndIdx);
  if (sectionLines.length === 0) return fullText;

  const hasOnlySkip = drawCalls.length > 0 && drawCalls.every(d => d.value === 'handling = skip');
  let drawStartIndex = -1;
  let runningCommentsStart = -1;

  for (let i = 1; i < sectionLines.length; i++) {
    const trimmed = sectionLines[i].trim();
    if (!trimmed) {
      runningCommentsStart = -1;
      continue;
    }

    if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
      if (runningCommentsStart === -1) {
        runningCommentsStart = i;
      }
      continue;
    }

    const isDraw = trimmed.match(/^drawindexed\s*=/i);
    const isIf = trimmed.match(/^if\s+/i);
    const isSkip = hasOnlySkip && trimmed.match(/^handling\s*=\s*skip\b/i);
    const isTtl = ttl.isTtlProperty(trimmed) || ttl.isTtlRunCommand(trimmed);

    if (isDraw || isIf || isSkip || isTtl) {
      drawStartIndex = runningCommentsStart !== -1 ? runningCommentsStart : i;
      break;
    }

    runningCommentsStart = -1;
  }

  let headerLines = [];
  if (drawStartIndex !== -1) {
    headerLines = sectionLines.slice(0, drawStartIndex);
  } else {
    headerLines = [...sectionLines];
  }

  while (headerLines.length > 1 && !headerLines[headerLines.length - 1].trim()) {
    headerLines.pop();
  }

  const generatedDrawLines = [];
  drawCalls.forEach(call => {
    generatedDrawLines.push('');

    if (call.value === 'handling = skip') {
      if (call.comment) {
        call.comment.split('\n').forEach(c => {
          const cleaned = c.replace(/^[;#]\s?/, '').trim();
          if (cleaned) {
            generatedDrawLines.push(`; ${cleaned}`);
          }
        });
      } else if (call.name && !call.name.startsWith('drawindexed =')) {
        generatedDrawLines.push(`; ${call.name}`);
      }

      if (call.condition && call.condition.trim()) {
        generatedDrawLines.push(`if ${call.condition.trim()}`);
        generatedDrawLines.push(`\thandling = skip`);
        generatedDrawLines.push(`endif`);
      }
    } else if (call.isTTL) {
      if (call.condition && call.condition.trim()) {
        generatedDrawLines.push(`if ${call.condition.trim()}`);
        const formatted = ttl.formatTtlLines(call, '\t');
        generatedDrawLines.push(...formatted);
        generatedDrawLines.push(`endif`);
      } else {
        const formatted = ttl.formatTtlLines(call, '');
        generatedDrawLines.push(...formatted);
      }
    } else {
      if (call.comment) {
        call.comment.split('\n').forEach(c => {
          const cleaned = c.replace(/^[;#]\s?/, '').trim();
          if (cleaned) {
            generatedDrawLines.push(`; ${cleaned}`);
          }
        });
      } else if (call.name && !call.name.startsWith('drawindexed =')) {
        generatedDrawLines.push(`; ${call.name}`);
      }

      if (call.condition && call.condition.trim()) {
        generatedDrawLines.push(`if ${call.condition.trim()}`);
        generatedDrawLines.push(`\tdrawindexed = ${call.value || 'auto'}`);
        generatedDrawLines.push(`endif`);
      } else {
        generatedDrawLines.push(`drawindexed = ${call.value || 'auto'}`);
      }
    }
  });

  const finalSectionLines = [
    ...headerLines,
    ...generatedDrawLines,
    '',
  ];

  lines.splice(targetStartIdx, targetEndIdx - targetStartIdx, ...finalSectionLines);
  return lines.join('\n');
}

/**
 * [Constants] 섹션에 변수 선언이 존재하는지 확인하고 안전하게 삽입합니다.
 * ; Constants ------------------------- 주석이 있으면 해당 주석 아래에 추가합니다.
 */
export function ensureConstantVariable(fullText, varName, defaultVal = 0) {
  if (!varName || !varName.startsWith('$')) return fullText;

  const regex = new RegExp(`^\\s*\\${varName}\\s*=`, 'mi');
  if (regex.test(fullText)) return fullText;

  const constantsRegex = /^\[Constants\]/im;
  const match = constantsRegex.exec(fullText);

  if (match) {
    const insertPos = match.index + match[0].length;
    const addition = `\nglobal persist ${varName} = ${defaultVal}`;
    return fullText.slice(0, insertPos) + addition + fullText.slice(insertPos);
  }

  // [Constants] 섹션이 없을 때: ; Constants ------------------------- 주석 확인
  const lines = fullText.split(/\r?\n/);
  const commentIdx = findConstantsCommentLineIndex(lines);
  const newConstLines = ['[Constants]', `global persist ${varName} = ${defaultVal}`];

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
    return lines.join('\n');
  }

  return `[Constants]\nglobal persist ${varName} = ${defaultVal}\n\n` + fullText;
}

/**
 * [Constants] 섹션에 변수를 추가하거나 기존 변수 선언(값/persist 여부)을 갱신합니다.
 * [Constants]가 없는 경우 ; Constants ------------------------- 주석 아래에 추가합니다.
 */
export function upsertConstantVariable(fullText, varName, defaultVal = 0, isPersist = true) {
  if (!varName || !varName.startsWith('$')) return fullText;

  const lines = fullText.split(/\r?\n/);
  let constStart = -1;
  let constEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(/^\[Constants\]/i)) {
      constStart = i;
    } else if (constStart !== -1 && trimmed.startsWith('[') && trimmed.includes(']')) {
      constEnd = i;
      break;
    }
  }

  const prefix = isPersist ? 'global persist' : 'global';
  const targetLine = `${prefix} ${varName} = ${defaultVal}`;

  if (constStart === -1) {
    // [Constants] 섹션이 없을 때: ; Constants 주석 아래에 추가
    const commentIdx = findConstantsCommentLineIndex(lines);
    const newConstLines = ['[Constants]', targetLine];

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
      return lines.join('\n');
    }

    return `[Constants]\n${targetLine}\n\n` + fullText;
  }

  let foundLineIdx = -1;
  for (let i = constStart + 1; i < constEnd; i++) {
    const trimmed = lines[i].trim();
    const regex = new RegExp(`^(?:(?:global\\s+(?:persist\\s+)?)?\\${varName}\\s*=)`, 'i');
    if (regex.test(trimmed)) {
      foundLineIdx = i;
      break;
    }
  }

  if (foundLineIdx !== -1) {
    lines[foundLineIdx] = targetLine;
  } else {
    let insertIdx = constEnd;
    while (insertIdx > constStart + 1 && !lines[insertIdx - 1].trim()) {
      insertIdx--;
    }
    lines.splice(insertIdx, 0, targetLine);
  }

  return lines.join('\n');
}

/**
 * [Constants] 섹션에서 특정 변수 선언 라인을 안전하게 제거합니다.
 */
export function removeConstantVariable(fullText, varName) {
  if (!varName) return fullText;
  const lines = fullText.split(/\r?\n/);
  let constStart = -1;
  let constEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.match(/^\[Constants\]/i)) {
      constStart = i;
    } else if (constStart !== -1 && trimmed.startsWith('[') && trimmed.includes(']')) {
      constEnd = i;
      break;
    }
  }

  if (constStart === -1) return fullText;

  const regex = new RegExp(`^(?:(?:global\\s+(?:persist\\s+)?)?\\${varName}\\s*=)`, 'i');
  const filtered = [];

  for (let i = 0; i < lines.length; i++) {
    if (i > constStart && i < constEnd && regex.test(lines[i].trim())) {
      continue;
    }
    filtered.push(lines[i]);
  }

  return filtered.join('\n');
}

/**
 * 지정된 섹션에 키-값 쌍들을 업서트(제자리 갱신 또는 추가)합니다.
 */
export function injectSectionProps(fullText, sectionName, props) {
  const lines = fullText.split(/\r?\n/);
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^\[(.*?)\]$/);
    if (match) {
      if (match[1].trim().toLowerCase() === sectionName.toLowerCase()) {
        startIdx = i;
      } else if (startIdx !== -1) {
        endIdx = i;
        break;
      }
    }
  }

  const newSectionLines = [`[${sectionName}]`];
  for (const [k, v] of Object.entries(props)) {
    newSectionLines.push(`${k} = ${v}`);
  }

  if (startIdx !== -1) {
    lines.splice(startIdx, endIdx - startIdx, ...newSectionLines);
  } else {
    // 새 섹션 삽입 위치 계산:
    // [Key...] 섹션이거나 Constants 블록에 속하는 섹션인 경우
    const isKeySection = /^Key/i.test(sectionName);

    // 1. 기존 [Key...] 섹션들이 이미 있는 경우: 마지막 [Key...] 섹션 바로 뒤에 배치
    let lastKeyEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\[Key/i.test(lines[i].trim())) {
        lastKeyEnd = findSectionEndIndex(lines, i);
      }
    }

    if (lastKeyEnd !== -1) {
      lines.splice(lastKeyEnd, 0, '', ...newSectionLines);
      return lines.join('\n');
    }

    // 2. [Present] 섹션이 있는 경우: [Present] 섹션 바로 뒤에 배치
    let presentStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\[Presents?\]/i.test(lines[i].trim())) {
        presentStart = i;
        break;
      }
    }
    if (presentStart !== -1) {
      const presentEnd = findSectionEndIndex(lines, presentStart);
      lines.splice(presentEnd, 0, '', ...newSectionLines);
      return lines.join('\n');
    }

    // 3. [Constants] 섹션이 있는 경우: [Constants] 섹션 바로 뒤에 배치
    let constStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\[Constants\]/i.test(lines[i].trim())) {
        constStart = i;
        break;
      }
    }
    if (constStart !== -1) {
      const constEnd = findSectionEndIndex(lines, constStart);
      lines.splice(constEnd, 0, '', ...newSectionLines);
      return lines.join('\n');
    }

    // 4. '; Constants -------------------------' 주석이 있는 경우: 해당 주석 바로 아래에 배치
    const commentIdx = findConstantsCommentLineIndex(lines);
    if (commentIdx !== -1) {
      let insertIdx = commentIdx + 1;
      while (insertIdx < lines.length && /^\s*;\s*[-=~#*]{3,}\s*$/.test(lines[insertIdx])) {
        insertIdx++;
      }
      if (insertIdx < lines.length && lines[insertIdx].trim() === '') {
        insertIdx++;
      } else {
        newSectionLines.unshift('');
      }
      newSectionLines.push('');
      lines.splice(insertIdx, 0, ...newSectionLines);
      return lines.join('\n');
    }

    // 5. 첫 번째 섹션(예: [TextureOverride...])이 있다면 그 앞에 배치
    let firstSecIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\[.*?\]$/.test(lines[i].trim())) {
        firstSecIdx = i;
        break;
      }
    }
    if (firstSecIdx !== -1 && isKeySection) {
      lines.splice(firstSecIdx, 0, ...newSectionLines, '');
      return lines.join('\n');
    }

    // 6. 그 외 기본 fallback (파일 끝에 추가)
    lines.push('', ...newSectionLines);
  }
  return lines.join('\n');
}

/**
 * 문서에서 특정 섹션을 삭제합니다.
 */
export function removeSectionFromText(fullText, sectionName) {
  const lines = fullText.split(/\r?\n/);
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^\[(.*?)\]$/);
    if (match) {
      if (match[1].trim().toLowerCase() === sectionName.toLowerCase()) {
        startIdx = i;
      } else if (startIdx !== -1) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx !== -1) {
    lines.splice(startIdx, endIdx - startIdx);
  }
  return lines.join('\n');
}
