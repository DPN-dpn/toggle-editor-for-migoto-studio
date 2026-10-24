/**
 * ZZMI TTL (Transparency / Translucent Layer) 라이브러리 핸들러
 * 3DMigoto/ZZMI에서 drawindexed 대신 사용되는 TTL 반투명 드로우 블록을 감지, 파싱, 서식화합니다.
 */

/**
 * 주어진 라인이 TTL 드로우 실행 구문인지 확인합니다.
 * 예: run = CommandList\TTL\Draw
 */
export function isTtlRunCommand(line) {
  if (!line) return false;
  const trimmed = line.trim();
  return /^run\s*=\s*CommandList[\\/]TTL[\\/]Draw/i.test(trimmed);
}

/**
 * 주어진 라인이 TTL 변수 대입식인지 확인합니다.
 * 예: $\TTL\alpha = 0.4, $\TTL\_1 = 2904, $\TTL\_2 = 0
 */
export function isTtlProperty(line) {
  if (!line) return false;
  const trimmed = line.trim();
  return /^\$?\\?TTL\\/i.test(trimmed);
}

/**
 * 주석 처리된 drawindexed 구문인지 확인하고 파라미터 값을 추출합니다.
 * 예: ;drawindexed = 2904, 0, 0 -> "2904, 0, 0"
 */
export function parseCommentedDrawIndexed(line) {
  if (!line) return null;
  const trimmed = line.trim();
  const match = trimmed.match(/^[;#]\s*drawindexed\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
  return match ? match[1].trim() : null;
}

/**
 * lines 배열에서 runIndex(run = CommandList\TTL\Draw) 위치 직전의
 * TTL 속성($\TTL...) 및 주석들을 거슬러 올라가며 안전하게 파싱합니다.
 */
export function extractTtlBlock(lines, runIndex, sectionName, condition) {
  let alpha = '0.5';
  let param1 = '';
  let param2 = '0';
  let param3 = '0';
  let commentedDrawIndexed = null;
  const comments = [];
  const rawLines = [lines[runIndex]];

  // run 바로 윗줄부터 거슬러 올라감
  let j = runIndex - 1;
  while (j >= 0) {
    const raw = lines[j];
    const trimmed = raw.trim();

    if (!trimmed) {
      break;
    }
    // 섹션 시작 헤더나 조건문 경계(if, elif, else, endif)를 만나면 정지
    if (
      trimmed.startsWith('[') ||
      /^if\s+/i.test(trimmed) ||
      /^(?:else\s+if|elif)\s+/i.test(trimmed) ||
      /^else/i.test(trimmed) ||
      /^endif/i.test(trimmed)
    ) {
      break;
    }

    if (isTtlProperty(trimmed)) {
      rawLines.unshift(raw);

      // $\TTL\alpha = ...
      const alphaMatch = trimmed.match(/^\$?\\?TTL\\alpha\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
      if (alphaMatch) alpha = alphaMatch[1].trim();

      // $\TTL\_1 = ...
      const p1Match = trimmed.match(/^\$?\\?TTL\\_1\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
      if (p1Match) param1 = p1Match[1].trim();

      // $\TTL\_2 = ...
      const p2Match = trimmed.match(/^\$?\\?TTL\\_2\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
      if (p2Match) param2 = p2Match[1].trim();

      // $\TTL\_3 = ...
      const p3Match = trimmed.match(/^\$?\\?TTL\\_3\s*=\s*(.*?)(?:\s*[;#].*)?$/i);
      if (p3Match) param3 = p3Match[1].trim();

      j--;
      continue;
    }

    // 주석 처리된 drawindexed 검사 (;drawindexed = 2904, 0, 0)
    const drawMatch = parseCommentedDrawIndexed(trimmed);
    if (drawMatch) {
      rawLines.unshift(raw);
      commentedDrawIndexed = drawMatch;
      j--;
      continue;
    }

    // 일반 주석 (; RoxyWPWcenterA-vb0=... (905))
    if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
      rawLines.unshift(raw);
      const cleanComment = trimmed.replace(/^[;#]\s?/, '').trim();
      if (cleanComment) {
        comments.unshift(cleanComment);
      }
      j--;
      continue;
    }

    // TTL과 무관한 일반 INI 속성을 만나면 정지
    break;
  }

  let name = '';
  if (comments.length > 0) {
    name = comments[comments.length - 1];
  } else if (commentedDrawIndexed) {
    name = `TTL (${commentedDrawIndexed})`;
  } else {
    name = `TTL (${param1 || 'Draw'})`;
  }

  const commentText = comments.join('\n').trim();
  const value = commentedDrawIndexed || (param1 ? `${param1}, ${param2}, ${param3}` : 'auto');

  return {
    id: `draw_ttl_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    sectionName: sectionName || 'Global',
    name,
    comment: commentText,
    value,
    isSkip: false,
    isTTL: true,
    condition: condition || null,
    lineIndex: runIndex,
    ttlData: {
      alpha,
      param1,
      param2,
      param3,
      commentedDrawIndexed,
      rawLines,
    },
  };
}

/**
 * TTL 드로우 객체를 3DMigoto/ZZMI INI 라인들로 서식화합니다.
 */
export function formatTtlLines(call, indent = '') {
  const lines = [];
  const ttlData = call.ttlData || {};

  // 1. 주석 복원
  if (call.comment) {
    call.comment.split('\n').forEach(c => {
      const cleaned = c.replace(/^[;#]\s?/, '').trim();
      if (cleaned) lines.push(`${indent}; ${cleaned}`);
    });
  } else if (call.name && !call.name.startsWith('TTL')) {
    lines.push(`${indent}; ${call.name}`);
  }

  // 2. 주석 처리된 drawindexed 복원 (; drawindexed = 2904, 0, 0)
  if (ttlData.commentedDrawIndexed) {
    lines.push(`${indent}; drawindexed = ${ttlData.commentedDrawIndexed}`);
  }

  // 3. TTL 파라미터 대입
  const alphaVal = ttlData.alpha || '0.5';
  lines.push(`${indent}$\\TTL\\alpha = ${alphaVal}`);

  let p1 = ttlData.param1;
  let p2 = ttlData.param2 || '0';
  let p3 = ttlData.param3 || '0';

  if (!p1 && call.value && call.value !== 'auto') {
    const parts = call.value.split(',').map(p => p.trim());
    p1 = parts[0] || '';
    if (parts[1]) p2 = parts[1];
    if (parts[2]) p3 = parts[2];
  }

  if (p1) {
    lines.push(`${indent}$\\TTL\\_1 = ${p1}`);
  }
  lines.push(`${indent}$\\TTL\\_2 = ${p2}`);
  if (p3 && p3 !== '0') {
    lines.push(`${indent}$\\TTL\\_3 = ${p3}`);
  }

  // 4. 실행 커맨드
  lines.push(`${indent}run = CommandList\\TTL\\Draw`);

  return lines;
}
