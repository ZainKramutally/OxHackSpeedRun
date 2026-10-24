; Multiply 7 × 10 by repeated addition.
; Reversible: nothing is overwritten, so every step can be undone.
        .code
start:  xori  r1, 10            ; n = 10
top:    lnd   ne, r2, r0, back  ; came from the back edge iff i != 0
        addi  r3, 7             ; acc += 7
        addi  r2, 1             ; i += 1
back:   br    ne, r2, r1, top   ; loop while i != n
        hlt
