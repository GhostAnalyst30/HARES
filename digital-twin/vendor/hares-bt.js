/**
 * HARES Digital Twin BT — copia extendida (NO reemplaza hares-bt.js de la raíz).
 * Añade: carga completa + cooldown, WAIT_GROUND, A* con costos semánticos.
 */
(function (root) {
    'use strict';

    var MODES = {
        FOLLOW_GROUND: 'FOLLOW_GROUND',
        WAIT_GROUND: 'WAIT_GROUND',
        DEPLOY_UAV: 'DEPLOY_UAV',
        AERIAL_FOLLOW: 'AERIAL_FOLLOW',
        RENDEZVOUS: 'RENDEZVOUS',
        LAND_DOCK: 'LAND_DOCK',
        EMERGENCY_RTL: 'EMERGENCY_RTL'
    };

    var STATUS = {
        IDLE: 'IDLE',
        SUCCESS: 'SUCCESS',
        RUNNING: 'RUNNING',
        FAILURE: 'FAILURE'
    };

    var DEFAULTS = {
        tWheel: 0.62,
        tLeg: 0.16,
        tSafe: 0.72,
        tBlocked: 0.05,
        tDeploy: 0.40,
        batUavCritical: 20,
        batUavMinDeploy: 22,
        batUavFull: 98,
        batUgvCritical: 15,
        redeployCooldownSec: 10,
        maxDetour: 3.2,
        lookaheadSteps: 4,
        lookaheadStep: 18,
        pathCols: 36,
        pathRows: 28,
        rendezvousDist: 14,
        landAlt: 0.6,
        hoverAlt: 25,
        followDist: 85,
        tickHz: 10,
        waypointSkip: 16,
        deployGateBias: 0
    };

    function hypot(dx, dy) {
        return Math.sqrt(dx * dx + dy * dy);
    }

    function dist(a, b) {
        return hypot(a.x - b.x, a.y - b.y);
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function fmt(n, d) {
        return Number(n).toFixed(d == null ? 2 : d);
    }

    function worldToGrid(x, y, bounds, cols, rows) {
        var w = Math.max(1e-6, bounds.maxX - bounds.minX);
        var h = Math.max(1e-6, bounds.maxY - bounds.minY);
        return {
            gx: clamp(Math.floor(((x - bounds.minX) / w) * cols), 0, cols - 1),
            gy: clamp(Math.floor(((y - bounds.minY) / h) * rows), 0, rows - 1)
        };
    }

    function gridToWorld(gx, gy, bounds, cols, rows) {
        var cw = (bounds.maxX - bounds.minX) / cols;
        var ch = (bounds.maxY - bounds.minY) / rows;
        return {
            x: bounds.minX + (gx + 0.5) * cw,
            y: bounds.minY + (gy + 0.5) * ch
        };
    }

    function sampleLookahead(world, ugv, step, steps) {
        var heading = ugv.heading || 0;
        var samples = [];
        var minT = 1;
        for (var i = 1; i <= steps; i++) {
            var x = ugv.x + Math.cos(heading) * step * i;
            var y = ugv.y + Math.sin(heading) * step * i;
            var T = world.isSolid(x, y) ? 0 : world.getT(x, y);
            samples.push({ x: x, y: y, T: T });
            if (T < minT) minT = T;
        }
        return { samples: samples, minT: minT };
    }

    function lineTransitable(world, a, b, tMin, n) {
        n = n || 12;
        for (var i = 1; i < n; i++) {
            var t = i / n;
            var x = a.x + (b.x - a.x) * t;
            var y = a.y + (b.y - a.y) * t;
            if (world.isSolid(x, y)) return false;
            if (tMin != null && world.getT(x, y) < tMin) return false;
        }
        return true;
    }

    function lineClear(world, a, b, n) {
        return lineTransitable(world, a, b, null, n);
    }

    function pathLength(path) {
        var L = 0;
        if (!path || path.length < 2) return Infinity;
        for (var i = 1; i < path.length; i++) L += dist(path[i - 1], path[i]);
        return L;
    }

    function findSafeGoal(world, target, tSafe, cfg) {
        if (!world.isSolid(target.x, target.y) && world.getT(target.x, target.y) >= tSafe) {
            return { x: target.x, y: target.y };
        }
        var bounds = world.bounds;
        var cols = cfg.pathCols;
        var rows = cfg.pathRows;
        var best = null;
        var bestD = Infinity;
        for (var gy = 0; gy < rows; gy++) {
            for (var gx = 0; gx < cols; gx++) {
                var p = gridToWorld(gx, gy, bounds, cols, rows);
                if (world.isSolid(p.x, p.y)) continue;
                if (world.getT(p.x, p.y) < tSafe) continue;
                var d = dist(p, target);
                if (d < bestD) {
                    bestD = d;
                    best = p;
                }
            }
        }
        return best || { x: target.x, y: target.y };
    }

    /** Costo de celda: 1/T base × multiplicador semántico (si world.getPathCost existe). */
    function cellStepCost(world, gx, gy, cfg, bounds, cols, rows) {
        var p = gridToWorld(gx, gy, bounds, cols, rows);
        var T = world.isSolid(p.x, p.y) ? 0 : world.getT(p.x, p.y);
        var base = 1 / Math.max(T, 0.08);
        if (typeof world.getPathCost === 'function') {
            return Math.max(0.05, world.getPathCost(p.x, p.y, base, T));
        }
        return base;
    }

    function findPath(world, from, to, cfg) {
        cfg = cfg || DEFAULTS;
        var bounds = world.bounds;
        var cols = cfg.pathCols;
        var rows = cfg.pathRows;
        var start = worldToGrid(from.x, from.y, bounds, cols, rows);
        var goal = worldToGrid(to.x, to.y, bounds, cols, rows);
        var startKey = start.gx + ',' + start.gy;
        var goalKey = goal.gx + ',' + goal.gy;

        function walkable(gx, gy, isStart) {
            var p = gridToWorld(gx, gy, bounds, cols, rows);
            if (isStart) return true;
            if (world.isSolid(p.x, p.y)) return false;
            return world.getT(p.x, p.y) >= cfg.tLeg;
        }

        if (!walkable(goal.gx, goal.gy, false)) {
            var safe = findSafeGoal(world, to, cfg.tSafe, cfg);
            goal = worldToGrid(safe.x, safe.y, bounds, cols, rows);
            goalKey = goal.gx + ',' + goal.gy;
        }

        var open = [startKey];
        var came = {};
        var gScore = {};
        gScore[startKey] = 0;
        var fScore = {};
        fScore[startKey] = hypot(start.gx - goal.gx, start.gy - goal.gy);
        var closed = {};
        var dirs = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];

        while (open.length) {
            var bestI = 0;
            var bestF = Infinity;
            for (var i = 0; i < open.length; i++) {
                var fs = fScore[open[i]];
                if (fs < bestF) {
                    bestF = fs;
                    bestI = i;
                }
            }
            var current = open.splice(bestI, 1)[0];
            if (current === goalKey) {
                var path = [];
                var k = current;
                while (k) {
                    var parts = k.split(',');
                    path.push(gridToWorld(+parts[0], +parts[1], bounds, cols, rows));
                    k = came[k];
                }
                path.reverse();
                if (path.length === 0) path.push({ x: from.x, y: from.y });
                if (!world.isSolid(to.x, to.y) && world.getT(to.x, to.y) > cfg.tBlocked) {
                    var last = path[path.length - 1];
                    if (!last || dist(last, to) > 1) path.push({ x: to.x, y: to.y });
                }
                return path;
            }
            closed[current] = true;
            var cparts = current.split(',');
            var cx = +cparts[0];
            var cy = +cparts[1];
            for (var d = 0; d < dirs.length; d++) {
                var nx = cx + dirs[d][0];
                var ny = cy + dirs[d][1];
                if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                var nk = nx + ',' + ny;
                if (closed[nk]) continue;
                var isStart = nx === start.gx && ny === start.gy;
                if (!walkable(nx, ny, isStart)) continue;
                var step = hypot(dirs[d][0], dirs[d][1]) * cellStepCost(world, nx, ny, cfg, bounds, cols, rows);
                var tentative = gScore[current] + step;
                if (gScore[nk] == null || tentative < gScore[nk]) {
                    came[nk] = current;
                    gScore[nk] = tentative;
                    fScore[nk] = tentative + hypot(nx - goal.gx, ny - goal.gy);
                    if (open.indexOf(nk) === -1) open.push(nk);
                }
            }
        }

        return [{ x: from.x, y: from.y }];
    }

    function nextWaypoint(path, pos, skipDist) {
        if (!path || path.length === 0) return null;
        var skip = skipDist == null ? 16 : skipDist;
        for (var i = 0; i < path.length; i++) {
            if (dist(pos, path[i]) > skip) return path[i];
        }
        return path[path.length - 1];
    }

    function node(id, label, status) {
        return { id: id, label: label, status: status };
    }

    function create(userOpts) {
        var cfg = {};
        var key;
        for (key in DEFAULTS) cfg[key] = DEFAULTS[key];
        if (userOpts) {
            for (key in userOpts) {
                if (Object.prototype.hasOwnProperty.call(userOpts, key) && userOpts[key] != null) {
                    cfg[key] = userOpts[key];
                }
            }
        }

        var mode = MODES.FOLLOW_GROUND;
        var lastTickAt = 0;
        var cached = null;
        var pendingOverride = null;
        var loco = 'WHEEL';
        var missionClock = 0;
        var cooldownUntil = 0;
        var justDocked = false;

        function reset() {
            mode = MODES.FOLLOW_GROUND;
            lastTickAt = 0;
            cached = null;
            pendingOverride = null;
            loco = 'WHEEL';
            missionClock = 0;
            cooldownUntil = 0;
            justDocked = false;
        }

        function uavFullyReady(uav) {
            return uav.battery >= cfg.batUavFull && missionClock >= cooldownUntil;
        }

        function requestDeploy(world) {
            if (mode !== MODES.FOLLOW_GROUND && mode !== MODES.WAIT_GROUND) {
                return { ok: false, reason: 'Anulación denegada: el UAV ya está en vuelo o desplegándose.' };
            }
            if (world && !uavFullyReady(world.uav)) {
                var coolLeft = Math.max(0, cooldownUntil - missionClock);
                return {
                    ok: false,
                    reason: 'Anulación denegada: UAV no listo (E=' +
                        fmt(world.uav.battery, 0) + '% / ' + cfg.batUavFull +
                        '%, cooldown ' + fmt(coolLeft, 1) + 's).'
                };
            }
            pendingOverride = 'deploy';
            cached = null;
            lastTickAt = 0;
            return { ok: true, reason: 'Anulación aceptada: despegue forzado en cola.' };
        }

        function requestRecall() {
            if (mode !== MODES.AERIAL_FOLLOW) {
                return { ok: false, reason: 'Anulación denegada: el UAV debe estar en seguimiento aéreo.' };
            }
            pendingOverride = 'recall';
            cached = null;
            lastTickAt = 0;
            return { ok: true, reason: 'Anulación aceptada: rendezvous forzado en cola.' };
        }

        function buildTree(active, emergencyTriggered, groundFailed, assessing, waiting) {
            function st(id) {
                if (emergencyTriggered && id === 'emergency') return STATUS.RUNNING;
                if (emergencyTriggered) {
                    if (id === 'root') return STATUS.RUNNING;
                    return STATUS.FAILURE;
                }
                if (id === 'root') return STATUS.RUNNING;
                if (id === 'emergency') return STATUS.SUCCESS;
                if (id === 'assess') return assessing ? STATUS.RUNNING : STATUS.SUCCESS;
                if (id === 'wait' && waiting) return STATUS.RUNNING;
                if (id === 'ground' && groundFailed) return STATUS.FAILURE;
                if (id === active) return STATUS.RUNNING;
                var order = ['ground', 'wait', 'aerial', 'rendezvous', 'land'];
                var ai = order.indexOf(active);
                var ni = order.indexOf(id);
                if (ni !== -1 && ai !== -1 && ni < ai) return STATUS.SUCCESS;
                return STATUS.IDLE;
            }
            return [
                node('emergency', 'Emergencia', st('emergency')),
                node('assess', 'Evaluar T', st('assess')),
                node('ground', 'Tierra', st('ground')),
                node('wait', 'Esperar', st('wait')),
                node('aerial', 'Aire', st('aerial')),
                node('rendezvous', 'Rendezvous', st('rendezvous')),
                node('land', 'Land & Dock', st('land'))
            ];
        }

        function pickLoco(Tnow) {
            if (loco === 'LEG') {
                if (Tnow >= cfg.tWheel + 0.08) loco = 'WHEEL';
            } else if (Tnow < cfg.tWheel) {
                loco = 'LEG';
            }
            return loco;
        }

        function markDocked() {
            justDocked = true;
            cooldownUntil = missionClock + cfg.redeployCooldownSec;
        }

        function compute(world) {
            var prevMode = mode;
            missionClock += 1 / cfg.tickHz;

            var ugv = world.ugv;
            var uav = world.uav;
            var human = world.human;
            var commsOk = world.commsOk !== false;
            var dPersona = dist(ugv, human);
            var Tnow = world.getT(ugv.x, ugv.y);
            var look = sampleLookahead(world, ugv, cfg.lookaheadStep, cfg.lookaheadSteps);
            var Tfwd = Math.min(Tnow, look.minT);
            var Tugv = Tnow;
            var Thuman = world.getT(human.x, human.y);
            var diag = hypot(world.bounds.maxX - world.bounds.minX, world.bounds.maxY - world.bounds.minY);
            var C = commsOk ? clamp(1 - dPersona / Math.max(diag, 1), 0.15, 1) : 0;
            var R = clamp((1 - Tfwd) * 0.75 + (dPersona > cfg.followDist * 2.2 ? 0.25 : 0), 0, 1);
            var U = clamp((1 - C) * 0.45 + (1 - Tfwd) * 0.35 + (dPersona / Math.max(diag, 1)) * 0.20, 0, 1);
            var E = Math.min(uav.battery, ugv.battery) / 100;
            var locomotion = pickLoco(Tnow);

            var groundGoal = findSafeGoal(world, human, cfg.tLeg, cfg);
            var groundPath = findPath(world, ugv, groundGoal, cfg);
            var pLen = pathLength(groundPath);
            var hasGroundRoute = groundPath.length > 1 && pLen < Infinity;
            var detour = hasGroundRoute ? pLen / Math.max(dPersona, cfg.waypointSkip) : 99;
            var routeTooCostly = !hasGroundRoute || detour > cfg.maxDetour;
            var losClear = lineClear(world, ugv, human, 14);
            var contactRisk = clamp((dPersona / cfg.followDist - 1) / 3, 0, 1);
            if (!losClear) contactRisk = Math.max(contactRisk, 0.5);

            var deployNeed = 0;
            if (!hasGroundRoute) deployNeed += 0.62;
            else deployNeed += clamp((detour - 2.4) / 4.0, 0, 0.35);
            deployNeed += 0.22 * contactRisk;
            deployNeed += 0.12 * U;
            deployNeed += 0.08 * R;
            deployNeed = clamp(deployNeed, 0, 1);

            var deployGate = 0.42
                + 0.36 * (1 - uav.battery / 100)
                + (hasGroundRoute ? 0.16 : 0)
                - 0.08 * U
                - (losClear ? 0 : 0.05)
                + (cfg.deployGateBias || 0);
            deployGate = clamp(deployGate, 0.24, 0.84);

            var ready = uavFullyReady(uav);
            var charging = (mode === MODES.FOLLOW_GROUND || mode === MODES.WAIT_GROUND) && uav.battery < cfg.batUavFull;
            var coolLeft = Math.max(0, cooldownUntil - missionClock);

            var airborne = mode !== MODES.FOLLOW_GROUND && mode !== MODES.WAIT_GROUND;
            var criticalUav = uav.battery < cfg.batUavCritical;
            var criticalUgv = ugv.battery < cfg.batUgvCritical;
            var emergency = airborne && (criticalUav || criticalUgv || !commsOk);

            var reason = '';
            var path = groundPath;
            var holdUgv = false;
            var ugvSpeedScale = locomotion === 'LEG' ? 0.55 : 1;
            var ugvWaypoint = { x: human.x, y: human.y };
            var uavTarget = { x: ugv.x, y: ugv.y, alt: 0 };
            var docked = false;
            var treeActive = 'ground';
            var groundFailed = false;
            var waiting = false;
            var ugvAction = 'FOLLOW';

            if (emergency && mode !== MODES.LAND_DOCK) {
                mode = MODES.EMERGENCY_RTL;
            }

            if (pendingOverride === 'deploy') {
                pendingOverride = null;
                if ((mode === MODES.FOLLOW_GROUND || mode === MODES.WAIT_GROUND) && ready) {
                    mode = MODES.DEPLOY_UAV;
                    reason = 'Anulación: despegue forzado. E_uav=' + fmt(uav.battery, 0) + '%.';
                } else if (mode === MODES.FOLLOW_GROUND || mode === MODES.WAIT_GROUND) {
                    reason = 'Anulación denegada: UAV no listo (carga/cooldown).';
                }
            } else if (pendingOverride === 'recall') {
                pendingOverride = null;
                if (mode === MODES.AERIAL_FOLLOW) {
                    mode = MODES.RENDEZVOUS;
                    reason = 'Anulación: retorno y rendezvous forzado.';
                }
            }

            // ML suggestion bias: cfg.mlPrefer in {FOLLOW, WAIT, DEPLOY}
            var mlPrefer = cfg.mlPrefer || null;

            if (mode === MODES.EMERGENCY_RTL) {
                treeActive = 'emergency';
                var why = !commsOk
                    ? 'enlace perdido'
                    : (criticalUav ? 'E_uav=' + fmt(uav.battery, 0) + '% < ' + cfg.batUavCritical + '%'
                        : 'E_ugv=' + fmt(ugv.battery, 0) + '% < ' + cfg.batUgvCritical + '%');
                var dUgv = dist(uav, ugv);
                if (dUgv < cfg.rendezvousDist) {
                    uavTarget = { x: ugv.x, y: ugv.y, alt: 0 };
                    if (uav.alt <= cfg.landAlt) {
                        mode = MODES.FOLLOW_GROUND;
                        docked = true;
                        markDocked();
                        reason = 'Emergencia resuelta: UAV acoplado. Recargando. Causa: ' + why + '.';
                    } else {
                        reason = 'RTL emergencia: descendiendo. ' + why + '.';
                    }
                } else {
                    uavTarget = { x: ugv.x, y: ugv.y, alt: cfg.hoverAlt };
                    reason = 'RTL emergencia: retorno al rover. ' + why + '.';
                }
                holdUgv = false;
                ugvSpeedScale = locomotion === 'LEG' ? 0.45 : 0.4;
                path = groundPath;
                ugvWaypoint = nextWaypoint(path, ugv, cfg.waypointSkip) || ugv;
                ugvAction = 'FOLLOW';
            } else if (mode === MODES.FOLLOW_GROUND || mode === MODES.WAIT_GROUND) {
                docked = true;
                uavTarget = { x: ugv.x, y: ugv.y, alt: 0 };

                var shouldDeploy = deployNeed > deployGate && ready;
                if (mlPrefer === 'DEPLOY' && ready && deployNeed > deployGate * 0.85) shouldDeploy = true;
                if (mlPrefer === 'WAIT') shouldDeploy = false;

                var shouldWait = routeTooCostly && !shouldDeploy;
                if (mlPrefer === 'WAIT') shouldWait = true;
                if (mlPrefer === 'FOLLOW' && hasGroundRoute && detour <= cfg.maxDetour * 1.15) shouldWait = false;

                if (shouldDeploy) {
                    groundFailed = true;
                    mode = MODES.DEPLOY_UAV;
                    docked = false;
                    reason = 'Despliego: need=' + fmt(deployNeed) + ' > gate=' + fmt(deployGate) +
                        ' (desvío ' + (hasGroundRoute ? fmt(detour, 1) + '×' : 'sin ruta') +
                        ', E_uav=' + fmt(uav.battery, 0) + '% READY).';
                    treeActive = 'aerial';
                    uavTarget = { x: ugv.x, y: ugv.y, alt: cfg.hoverAlt };
                    holdUgv = false;
                    ugvAction = 'REQUEST_AIR';
                } else if (shouldWait) {
                    mode = MODES.WAIT_GROUND;
                    waiting = true;
                    treeActive = 'wait';
                    holdUgv = true;
                    ugvSpeedScale = 0;
                    ugvWaypoint = { x: ugv.x, y: ugv.y };
                    ugvAction = 'WAIT';
                    var chargeTxt = charging
                        ? ' UAV cargando ' + fmt(uav.battery, 0) + '%→' + cfg.batUavFull + '%.'
                        : (coolLeft > 0
                            ? ' Cooldown redespliegue ' + fmt(coolLeft, 1) + 's.'
                            : ' UAV listo; evaluando need/gate.');
                    reason = 'WAIT: terreno inaccesible o desvío ' +
                        (hasGroundRoute ? fmt(detour, 1) + '× > ' + cfg.maxDetour : '∞') +
                        '. Humano libre; rover espera.' + chargeTxt;
                } else {
                    mode = MODES.FOLLOW_GROUND;
                    treeActive = 'ground';
                    holdUgv = dPersona <= cfg.followDist;
                    ugvWaypoint = nextWaypoint(groundPath, ugv, cfg.waypointSkip) || groundGoal;
                    ugvAction = locomotion === 'LEG' ? 'FOLLOW_LEG' : 'FOLLOW_WHEEL';
                    var locoTxt = locomotion === 'LEG'
                        ? 'Patas: T=' + fmt(Tnow) + ' < ' + fmt(cfg.tWheel) + '.'
                        : 'Ruedas: T=' + fmt(Tnow) + ' OK.';
                    var readyTxt = ready
                        ? ' UAV READY.'
                        : (charging
                            ? ' UAV cargando ' + fmt(uav.battery, 0) + '%.'
                            : ' Cooldown ' + fmt(coolLeft, 1) + 's.');
                    reason = locoTxt + ' Ruta semántica desvío ' + fmt(detour, 1) + '×.' + readyTxt +
                        (holdUgv ? ' Distancia OK.' : ' Siguiendo.');
                }
            } else if (mode === MODES.DEPLOY_UAV) {
                treeActive = 'aerial';
                groundFailed = true;
                holdUgv = routeTooCostly;
                ugvAction = holdUgv ? 'WAIT' : 'FOLLOW';
                ugvWaypoint = holdUgv
                    ? { x: ugv.x, y: ugv.y }
                    : (nextWaypoint(groundPath, ugv, cfg.waypointSkip) || groundGoal);
                if (holdUgv) ugvSpeedScale = 0;
                uavTarget = { x: ugv.x, y: ugv.y, alt: cfg.hoverAlt };
                if (!reason) {
                    reason = 'Despegue: alt=' + fmt(uav.alt, 1) + ' / ' + fmt(cfg.hoverAlt, 0) + ' m.';
                }
                if (uav.alt >= cfg.hoverAlt * 0.96) {
                    mode = MODES.AERIAL_FOLLOW;
                    reason = 'UAV en techo. Relé aéreo activo.';
                }
            }

            if (mode === MODES.AERIAL_FOLLOW) {
                treeActive = 'aerial';
                groundFailed = true;
                uavTarget = { x: human.x, y: human.y, alt: cfg.hoverAlt };
                path = groundPath;
                if (routeTooCostly) {
                    holdUgv = true;
                    ugvSpeedScale = 0;
                    ugvWaypoint = { x: ugv.x, y: ugv.y };
                    ugvAction = 'WAIT';
                } else {
                    ugvWaypoint = nextWaypoint(path, ugv, cfg.waypointSkip) || groundGoal;
                    ugvSpeedScale = locomotion === 'LEG' ? 0.55 : 1;
                    holdUgv = dPersona <= cfg.followDist;
                    ugvAction = locomotion === 'LEG' ? 'FOLLOW_LEG' : 'FOLLOW_WHEEL';
                }
                var canRejoin = Tugv > cfg.tSafe * 0.85 && Thuman > cfg.tLeg && losClear && detour < 1.8;
                if (canRejoin) {
                    mode = MODES.RENDEZVOUS;
                    reason = 'Rendezvous: reencuentro viable (LOS, T_ugv=' + fmt(Tugv) + ', desvío ' + fmt(detour, 1) + '×).';
                } else if (!reason || prevMode === MODES.AERIAL_FOLLOW) {
                    reason = 'Aéreo: UAV cubre. UGV ' + (ugvAction === 'WAIT' ? 'ESPERA' : 'replanifica') +
                        ' T=' + fmt(Tugv) + '.';
                }
            }

            if (mode === MODES.RENDEZVOUS) {
                treeActive = 'rendezvous';
                groundFailed = true;
                uavTarget = { x: ugv.x, y: ugv.y, alt: cfg.hoverAlt };
                ugvSpeedScale = locomotion === 'LEG' ? 0.45 : 0.5;
                holdUgv = dPersona <= cfg.followDist;
                if (!holdUgv) ugvWaypoint = nextWaypoint(groundPath, ugv, cfg.waypointSkip) || human;
                path = groundPath;
                ugvAction = 'RENDEZVOUS';
                if (dist(uav, ugv) < cfg.rendezvousDist) {
                    mode = MODES.LAND_DOCK;
                    reason = 'Marcador de plataforma en rango. Iniciando LAND_DOCK.';
                } else if (!reason || prevMode === MODES.RENDEZVOUS) {
                    reason = 'Rendezvous: UAV → UGV (d=' + fmt(dist(uav, ugv), 1) + ').';
                }
            }

            if (mode === MODES.LAND_DOCK) {
                treeActive = 'land';
                groundFailed = true;
                uavTarget = { x: ugv.x, y: ugv.y, alt: 0 };
                ugvSpeedScale = locomotion === 'LEG' ? 0.4 : 0.35;
                holdUgv = dPersona <= cfg.followDist;
                ugvAction = 'RENDEZVOUS';
                if (uav.alt <= cfg.landAlt && dist(uav, ugv) < cfg.rendezvousDist * 1.4) {
                    mode = MODES.FOLLOW_GROUND;
                    docked = true;
                    markDocked();
                    uavTarget = { x: ugv.x, y: ugv.y, alt: 0 };
                    reason = 'Aterrizaje OK. Docking + carga completa requerida antes de redesplegar (' +
                        cfg.batUavFull + '% + cooldown ' + cfg.redeployCooldownSec + 's).';
                } else if (!reason || prevMode === MODES.LAND_DOCK) {
                    reason = 'Land & Dock: alineando pad, alt=' + fmt(uav.alt, 1) + ' m.';
                }
            }

            if (mode === MODES.FOLLOW_GROUND || mode === MODES.WAIT_GROUND) {
                docked = true;
                uavTarget = { x: ugv.x, y: ugv.y, alt: 0 };
            }

            var assessing = Tfwd < cfg.tWheel || routeTooCostly;
            var tree = buildTree(treeActive, mode === MODES.EMERGENCY_RTL, groundFailed, assessing, waiting);

            return {
                mode: mode,
                prevMode: prevMode,
                modeChanged: mode !== prevMode,
                blackboard: {
                    d_persona: dPersona,
                    T_terreno: Tnow,
                    T_fwd: Tfwd,
                    E_bateria: E,
                    R_riesgo: R,
                    C_comunicacion: C,
                    U_incertidumbre: U,
                    deploy_need: deployNeed,
                    deploy_gate: deployGate,
                    detour: detour,
                    uav_ready: ready,
                    uav_charging: charging,
                    cooldown_s: coolLeft,
                    ugv_action: ugvAction,
                    path_cost: pLen
                },
                intent: {
                    reason: reason,
                    locomotion: locomotion,
                    holdUgv: holdUgv,
                    ugvSpeedScale: ugvSpeedScale,
                    ugvWaypoint: ugvWaypoint,
                    uavTarget: uavTarget,
                    docked: docked,
                    ugvAction: ugvAction
                },
                path: path,
                lookahead: look.samples,
                tree: tree
            };
        }

        function tick(world) {
            var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            var interval = 1000 / cfg.tickHz;
            if (cached && now - lastTickAt < interval) return cached;
            lastTickAt = now;
            cached = compute(world);
            return cached;
        }

        return {
            tick: tick,
            reset: reset,
            requestDeploy: requestDeploy,
            requestRecall: requestRecall,
            getMode: function () { return mode; },
            cfg: cfg,
            MODES: MODES
        };
    }

    root.HARES_BT = {
        create: create,
        findPath: findPath,
        findSafeGoal: findSafeGoal,
        sampleLookahead: sampleLookahead,
        nextWaypoint: nextWaypoint,
        lineClear: lineClear,
        MODES: MODES,
        STATUS: STATUS,
        DEFAULTS: DEFAULTS
    };
})(typeof window !== 'undefined' ? window : this);
