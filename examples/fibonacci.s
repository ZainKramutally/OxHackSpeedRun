; Fibonacci: write the first 12 terms to memory.
; (a, b) -> (b, a + b) is reversible: add, then swap.
        .data
fib:    .space 12
        .code
start:  xori  r2, 1             ; b = 1 (a = r1 = 0)
        xori  r4, 12            ; n = 12
        xori  r5, fib           ; pointer
top:    lnd   ne, r3, r0, back
        xst   r2, [r5+0]        ; fib[i] ^= b
        add   r1, r2            ; a = a + b
        swap  r1, r2            ; (a, b) = (b, a + b)
        addi  r5, 1
        addi  r3, 1
back:   br    ne, r3, r4, top
        hlt
