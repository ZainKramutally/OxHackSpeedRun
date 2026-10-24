; Draw a V on the 64×32 display.
; Pixels are XORed in, so stepping back erases them.
        .equ  FB, 0x20000
        .code
start:  xori  r5, FB            ; left arm: top-left, going down-right
        xori  r8, FB            ; right arm: top-right, going down-left
        addi  r8, 63
        xori  r6, 0x2D          ; colour 0x2DD4BF, built in parts
        roli  r6, 16
        xori  r6, 0xD4BF
        xori  r4, 32            ; 32 rows
top:    lnd   ne, r3, r0, back
        xst   r6, [r5+0]        ; draw (XOR) both pixels
        xst   r6, [r8+0]
        addi  r5, 65            ; one row down, one column right
        addi  r8, 63            ; one row down, one column left
        addi  r3, 1
back:   br    ne, r3, r4, top
        hlt
