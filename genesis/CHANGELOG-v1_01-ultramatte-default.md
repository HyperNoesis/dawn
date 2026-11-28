# v1.01 - UltraMatte is the default and the governor never leaves it

- Default engine is now Genesis UltraMatte (flag `ultraDefault` in `flags.json`; set it to 0 to restore the old Automatic behaviour without a redeploy of code).
- It is treated like an explicit choice: no startup benchmark gate and no silent swap to MODNet. A person who picks Automatic or another engine in the picker keeps that choice.
- Quality governor: when UltraMatte runs, the chain contains only UltraMatte's size steps (512, 448, 384, 320) and there is no light-model emergency rung. Load lowers the picture size; it never changes the engine.
- If UltraMatte cannot initialise at all, the existing start-up error path still shows the camera and says why.
- Qualification registry is unchanged: UltraMatte is still "experimental" there (12 real stills, no video, no phone). This release is a product default, not a quality approval.
