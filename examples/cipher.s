; XOR cipher: encrypt "HELLO OX" in place.
; Flip the direction to Inverse to run it backwards and decrypt.
        .data
msg:    .word 'H','E','L','L','O',' ','O','X'
        .code
start:  xori  r1, 0x2A5         ; key
        xori  r4, 8             ; length
        xori  r5, msg           ; pointer
top:    lnd   ne, r3, r0, back
        xst   r1, [r5+0]        ; msg[i] ^= key
        roli  r1, 7             ; scramble the key
        addi  r1, 29
        addi  r5, 1
        addi  r3, 1
back:   br    ne, r3, r4, top
        hlt
