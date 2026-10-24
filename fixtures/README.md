# 검증 문서

`paragraph-overlay.hwpx`는 `node scripts/generate-overlay-fixture.mjs`가 만드는 자체 합성 문서입니다. 인라인 표 뒤에 문단 기준의 글 앞 그림을 넣어, 표가 진행시킨 흐름 좌표와 문단 기준 좌표가 혼동되지 않는지 검사합니다. 고객 문서의 내용이나 이미지는 포함하지 않습니다.

모든 문서는 `scripts/generate-fixtures.mjs`가 직접 생성한 합성 문서이며 프로젝트의 Apache-2.0 라이선스로 제공합니다. 업무·정부·고객 문서와 upstream 샘플은 포함하지 않습니다. PNG 그림도 스크립트에 포함한 합성 픽셀 데이터입니다.

각 형식에 `blank`, `sample`, `rich`의 세 문서가 있습니다. 빈 문서, 한국어 본문, 기본 표, 여러 페이지와 그림을 다룹니다. DOCX rich 문서에는 머리말·꼬리말과 병합 셀이 있습니다. 이것은 시험용 corpus이며 모든 Office 구조를 다루는 corpus는 아닙니다.

`yarn fixtures:generate`로 재생성합니다. 생성 결과는 `fixtures/`와 독립 앱의 `public/samples/`에 복사됩니다. 브라우저 테스트는 텍스트·표 존재·그림 bytes·서식 XML·재열기 결과를 검사합니다. 복잡한 필드·도형·댓글·변경 추적·차트·매크로와 암호화 문서는 후속 corpus가 필요합니다.

HWP5의 `blank`, `sample`, `rich`, `long`은 `scripts/generate-hwp-fixtures.mjs`가 자체 제작 HWPX 문서로부터 생성합니다. HWP 바이너리 검증, 한글 조합 입력, 공통 UI·글꼴, 에이전트 치환·구조 조회, 원본 형식 저장·재열기, 초안 복구와 저장 재시도에 사용합니다. 고객 문서나 상용 샘플은 포함하지 않습니다.

`node scripts/generate-complex-fixtures.mjs`는 자체 제작 rich.docx에 DATE 필드와 각주를 추가한 complex.docx를 생성합니다. 브라우저 검사는 첫 원본 직렬화와 편집본의 비대상 XML을 비교하고 미디어 bytes, 표·필드·각주, 저장·재열기를 검사합니다. ZIP 디렉터리 항목과 XML 선언/속성 순서의 정규화를 콘텐츠 손실로 세지 않습니다. 외부 실무 corpus는 포함하지 않습니다.
